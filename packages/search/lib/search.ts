import { EMBEDDING, INDEXING } from "@spark/core";
import {
  embedCostMicros,
  ProviderError,
  queryText,
  type AiCall,
  type Embedder,
} from "@spark/indexing";

/** The query's side of the vector leg (as @spark/db's Library takes it). */
export type Probe = { model: string; dimensions: number } & (
  { vector: number[] } | { like: string }
);

/** What a search leg returns per Memory, at least. */
export type Hit = { matched: string[]; distance: number | null };

/** Instant: keyword and typo only, per keystroke. Full: with the vector leg, after a pause. */
export type Mode = "instant" | "full";

export type Ranked<R> = R & { match: "direct" | "related" };

/** A recent query's vector, per person and embedding space. */
const cache = new Map<string, { vector: number[]; at: number }>();

function cached(key: string, now: number) {
  const hit = cache.get(key);
  if (!hit || now - hit.at > EMBEDDING.queryCacheMs) return undefined;
  // Most recently used last: the first key is the one to drop.
  cache.delete(key);
  cache.set(key, hit);
  return hit.vector;
}

function remember(key: string, vector: number[], now: number) {
  cache.set(key, { vector, at: now });
  if (cache.size > EMBEDDING.queryCacheSize) {
    cache.delete(cache.keys().next().value!);
  }
}

/**
 * Direct when a keyword matched or a vector came very close (ADR-0008's
 * judge replaces this, PLAN.md §6.4); Related otherwise. Order is kept.
 */
export const split = <R extends Hit>(hits: R[]): Ranked<R>[] =>
  hits.map((hit) => ({
    ...hit,
    match:
      hit.matched.includes("keyword") ||
      (hit.distance !== null && hit.distance <= EMBEDDING.directDistance)
        ? "direct"
        : "related",
  }));

/**
 * One person's search (ADR-0004, PLAN.md §6): instant mode per keystroke,
 * full mode with the query embedded, and More Like This. Full mode falls
 * back to instant, silently, when there is no embedder, the daily budget
 * is spent, or the provider fails or is slow. Query vectors are cached
 * briefly per person; queries, vectors and content are never logged.
 */
export function createSearch<R extends Hit>({
  userId,
  find,
  embedder,
  spend,
  now = Date.now,
}: {
  userId: string;
  /** The Library's hybrid search. */
  find: (
    query: string,
    options: { probe?: Probe; maxDistance: number }
  ) => Promise<R[]>;
  embedder?: Embedder;
  /** The budget breaker's side of the database (`indexingStore`). */
  spend: {
    spentTodayMicros(): Promise<number>;
    recordCall(call: AiCall): Promise<void>;
  };
  now?: () => number;
}) {
  const space = embedder && {
    model: embedder.model,
    dimensions: embedder.dimensions,
  };

  async function embedQuery(query: string): Promise<number[] | undefined> {
    if (!embedder) return undefined;
    const key = [userId, embedder.model, embedder.dimensions, query].join("\0");
    const hit = cached(key, now());
    if (hit) return hit;
    if ((await spend.spentTodayMicros()) >= INDEXING.dailyBudgetMicros) {
      return undefined;
    }
    const record = (textTokens: number, estimated?: boolean) =>
      spend.recordCall({
        userId,
        memoryId: null,
        provider: embedder.name,
        model: embedder.model,
        usage: { inputTokens: textTokens, outputTokens: 0 },
        costMicros: embedCostMicros(embedder.model, {
          textTokens,
          imageTokens: 0,
        }),
        ...(estimated && { estimated }),
      });
    try {
      const { vectors, usage } = await embedder.embed(
        [{ text: queryText(query) }],
        { timeoutMs: EMBEDDING.queryTimeoutMs }
      );
      await record(usage.textTokens);
      remember(key, vectors[0]!, now());
      return vectors[0];
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.estimate) await record(error.estimate.inputTokens, true);
      return undefined;
    }
  }

  return {
    async search(query: string, mode: Mode): Promise<Ranked<R>[]> {
      const q = query.trim().replace(/\s+/g, " ");
      if (!q) return [];
      const vector = mode === "full" ? await embedQuery(q) : undefined;
      const probe = vector && space && { ...space, vector };
      return split(
        await find(q, {
          ...(probe && { probe }),
          maxDistance: EMBEDDING.maxDistance,
        })
      );
    },

    /** More Like This: the Memory's own vectors as the query, no provider call. */
    async similar(memoryId: string): Promise<Ranked<R>[]> {
      if (!space) return [];
      return split(
        await find("", {
          probe: { ...space, like: memoryId },
          maxDistance: EMBEDDING.maxDistance,
        })
      );
    },
  };
}

export type Search<R extends Hit> = ReturnType<typeof createSearch<R>>;
