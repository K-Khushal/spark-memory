import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { embeddingSpace } from "@spark/core";
import { indexingStore, openLibrary, schema, type Database } from "@spark/db";
import {
  createIndexer,
  type Embedder,
  type IndexOutcome,
  type Provider,
} from "@spark/indexing";
import { createSearch } from "@spark/search";
import { readLibraryFile, type LibraryItem, type SearchCase } from "./manifest";

export type SearchOutcome = {
  id: string;
  kind: string;
  query: string;
  /** 1-based position of the first right Memory in the results; null when it is not there. */
  rank: number | null;
  /** The five best results, as sample Library ids. */
  top: string[];
  /** Which legs found the right Memory (keyword, typo, vector). */
  matchedBy: string[];
  /** Full search fell back to keywords (no vector leg). */
  fellBack: boolean;
};

export type Report = {
  memories: number;
  searches: SearchOutcome[];
  costMicros: number;
};

/**
 * Re-orders the best results of a search (ADR-0004's reranker experiment):
 * given the query and each candidate's text, returns the ids best first.
 */
export type Reranker = (
  query: string,
  candidates: { id: string; text: string }[]
) => Promise<string[]>;

/** How many of the best results a reranker sees (the PLAN's "top ~20"). */
export const RERANK_TOP = 20;

export type RunOptions = {
  db: Database;
  items: LibraryItem[];
  searches: SearchCase[];
  providers: Provider[];
  embedder?: Embedder;
  /** Memories Indexed at once: 1 keeps a paid provider's rate limits happy. */
  concurrency?: number;
  rerank?: Reranker;
  log?: (line: string) => void;
};

/** Run `work` over `list`, `width` at a time. */
async function pool<T>(
  list: T[],
  width: number,
  work: (item: T) => Promise<void>
) {
  const queue = [...list];
  await Promise.all(
    Array.from({ length: Math.min(width, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift())
        await work(next);
    })
  );
}

/**
 * The same Memory id for the same sample id on every run: ties in the hybrid
 * SQL break on the id, so random ids would make the order, and the baseline,
 * change from run to run. (Version 8, "custom" UUID.)
 */
function memoryId(sampleId: string) {
  const h = createHash("sha256").update(`spark-evals:${sampleId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x80;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Loads the sample Library into a throwaway person's Library through the
 * real Capture (text and image), Indexing and search code, runs every
 * search in full mode and reports where the right Memory landed. The
 * person, and with them every Memory, is deleted at the end.
 */
export async function runEvals({
  db,
  items,
  searches,
  providers,
  embedder,
  concurrency = 4,
  rerank,
  log = () => {},
}: RunOptions): Promise<Report> {
  const userId = crypto.randomUUID();
  await db
    .insert(schema.user)
    .values({ id: userId, name: "", email: `evals-${userId}@example.com` });
  try {
    const library = openLibrary(db, userId, {
      vectorsSpace:
        embedder && embeddingSpace(embedder.model, embedder.dimensions),
    });
    const store = indexingStore(db);
    const files = new Map<string, Uint8Array>();
    const itemOf = new Map<string, string>();
    /** What a text reranker reads of each Memory: its title and what is in it. */
    const textOf = new Map<string, string>();
    const jobs: { memoryId: string; run: number }[] = [];

    for (const item of items) {
      const id = memoryId(item.id);
      let run: number;
      if (item.kind === "text") {
        const body = (await readLibraryFile(item.text!)).toString("utf8");
        textOf.set(item.id, `${item.title ?? ""}\n${body}`.slice(0, 2000));
        const captured = await library.capture({
          id,
          body,
          title: item.title,
          captureNote: item.captureNote,
        });
        if (!("memory" in captured))
          throw new Error(`${item.id}: capture conflict`);
        run = captured.memory.indexRun;
      } else {
        const bytes = new Uint8Array(await readLibraryFile(item.file!));
        const { image } = item;
        textOf.set(
          item.id,
          `${item.extraction?.title ?? ""}\n${item.extraction?.description ?? ""}\n${item.extraction?.ocrText ?? ""}`
        );
        const captured = await library.captureImage({
          id,
          mime: image!.mime,
          bytes: bytes.length,
          width: image!.width,
          height: image!.height,
          contentHash: image!.contentHash,
          thumbhash: image!.thumbhash,
          palette: image!.palette,
          // The browser's thumbnail is not needed to search: the file stands in.
          thumbnail: { mime: "image/jpeg", bytes: bytes.length },
        });
        if (!("memory" in captured))
          throw new Error(`${item.id}: ${JSON.stringify(captured)}`);
        for (const upload of captured.uploads) files.set(upload.key, bytes);
        const stored = await library.markStored(id);
        if (!stored || typeof stored === "string")
          throw new Error(`${item.id}: not stored`);
        run = captured.memory.indexRun;
      }
      itemOf.set(id, item.id);
      jobs.push({ memoryId: id, run });
    }
    log(`captured ${jobs.length} Memories`);

    const indexer = createIndexer({
      store,
      providers,
      embedder,
      readFile: async (key) => files.get(key),
    });
    const failed: string[] = [];
    await pool(jobs, concurrency, async ({ memoryId, run }) => {
      let outcome: IndexOutcome = { result: "skipped" };
      for (let attempt = 1; attempt <= 3; attempt++) {
        outcome = await indexer.index({
          memoryId,
          priority: "fresh",
          attempt,
          run,
        });
        if (outcome.result !== "retry") break;
        await sleep(Math.min(outcome.delaySeconds, 20) * 1000);
      }
      if (outcome.result !== "searchable")
        failed.push(`${itemOf.get(memoryId)}:${outcome.result}`);
    });
    if (failed.length)
      throw new Error(`Indexing did not finish: ${failed.join(", ")}`);
    // Fresh tables have no statistics, and the planner's first autovacuum
    // lands mid-run: analyse now so every run searches with the same plans
    // (ties in the fused ranking follow them).
    await db.execute(sql`analyze memory`);
    await db.execute(sql`analyze memory_vector`);
    await db.execute(sql`analyze memory_word`);
    log("indexed");

    const search = createSearch({
      userId,
      find: (query, options) => library.search(query, options),
      embedder,
      // The daily AI budget protects users, not this throwaway Library: a
      // search that fell back to keywords would quietly score the wrong thing.
      spend: {
        ...store,
        dailyBudgetMicros: async () => Number.MAX_SAFE_INTEGER,
      },
    });
    const outcomes: SearchOutcome[] = [];
    for (const c of searches) {
      const { results, mode } = await search.search(c.query, "full");
      let ids = results.map((r) => itemOf.get(r.id) ?? r.id);
      if (rerank) {
        const head = ids.slice(0, RERANK_TOP);
        const order = await rerank(
          c.query,
          head.map((id) => ({ id, text: textOf.get(id) ?? "" }))
        );
        ids = [
          ...order.filter((id) => head.includes(id)),
          ...ids.slice(RERANK_TOP),
        ];
      }
      const at = ids.findIndex((id) => c.expect.includes(id));
      outcomes.push({
        id: c.id,
        kind: c.kind,
        query: c.query,
        rank: at < 0 ? null : at + 1,
        top: ids.slice(0, 5),
        matchedBy: at < 0 ? [] : results[at]!.matched,
        fellBack: embedder !== undefined && mode !== "full",
      });
    }

    const [spent] = await db
      .select({
        micros: sql<string>`coalesce(sum(${schema.aiCall.costMicros}), 0)`,
      })
      .from(schema.aiCall)
      .where(eq(schema.aiCall.userId, userId));
    return {
      memories: items.length,
      searches: outcomes,
      costMicros: Number(spent?.micros ?? 0),
    };
  } finally {
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }
}
