import { and, eq, lt, sql } from "drizzle-orm";
import {
  EMBEDDING,
  Categories,
  embeddingSpace,
  type IndexFailure,
  type IndexingOutput,
  type LinkMetadata,
  type MemoryKind,
  type ProviderName,
  type TranscriptSegment,
} from "@spark/core";
import { readDailyBudgetMicros } from "./admin";
import type { Database } from "./client";
import { ANONYMISED_USER, lockOwner } from "./owner";
import {
  accountDeletion,
  aiCall,
  memory,
  memoryFile,
  memoryIndex,
  memoryVector,
  spendDay,
  user,
  type VectorAnchor,
  type VectorKind,
} from "./schema";

/**
 * The row a delivery took, as `load` read it (structurally @spark/indexing's
 * Claim). The generation is the server's, set when the row is created, so a
 * Memory deleted and saved again with the same id (by anyone) never matches.
 */
export type Claim = {
  memoryId: string;
  userId: string;
  generation: string;
  run: number;
};

/**
 * What a queue message names: the Memory, and the run and generation it was
 * sent for when it carries them (messages sent before they were do not).
 */
export type IndexMessageTarget = {
  memoryId: string;
  run?: number;
  generation?: string;
};

/** A Memory's vectors as one model made them from one revision of its text. */
export type Embedding = {
  model: string;
  dimensions: number;
  revision: number;
  vectors: { kind: VectorKind; anchor?: VectorAnchor; embedding: number[] }[];
};

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Replaces a Memory's vectors and notes what they were made from. */
async function replaceVectors(
  tx: Tx,
  id: string,
  userId: string,
  { model, dimensions, revision, vectors }: Embedding
) {
  await tx.delete(memoryVector).where(eq(memoryVector.memoryId, id));
  if (vectors.length) {
    await tx.insert(memoryVector).values(
      vectors.map((v) => ({
        memoryId: id,
        userId,
        kind: v.kind,
        anchor: v.anchor ?? null,
        model,
        dimensions,
        embedding: v.embedding,
      }))
    );
  }
  await tx
    .update(memory)
    .set({
      vectorsSpace: embeddingSpace(model, dimensions),
      vectorsRevision: revision,
    })
    .where(eq(memory.id, id));
}

/** Searchable, AI allowed, and Indexing found something to embed. */
const embeddable = sql`${memory.indexState} = 'searchable' and not ${memory.aiOptOut} and exists (select 1 from memory_index i where i.memory_id = ${memory.id})`;
/** Vectors missing, from another model or size, or from an older revision. */
const vectorsStaleIn = (space: string) =>
  sql`(${memory.vectorsSpace} is distinct from ${space} or ${memory.vectorsRevision} is distinct from ${memory.revision})`;
/** Not locked by the user, and not yet categorised at this revision. */
const categoriesStale = sql<boolean>`(not ${memory.categoriesLocked} and ${memory.categoriesRevision} is distinct from ${memory.revision})`;
/** What the hourly sweep and `embed` jobs pick up: vectors or Categories to make. */
const staleIn = (space: string) =>
  sql`(${vectorsStaleIn(space)} or ${categoriesStale})`;

/** Today in UTC, by the database's clock: the day the budget counts. */
const today = sql`(now() at time zone 'utc')::date`;

/** Longer than any one message's provider calls take. */
const LEASE_MINUTES = 5;
/** Free to take: never leased, the lease ran out, or it was for an older run. */
const unleased = sql`(${memory.indexLeaseUntil} is null or ${memory.indexLeaseUntil} < now() or ${memory.indexLeaseRun} is distinct from ${memory.indexRun})`;
const lease = () => ({
  indexLeaseUntil: sql`now() + make_interval(mins => ${LEASE_MINUTES})`,
});

/** The row a message names, as far as it names it: only for taking work, never to write a result. */
const named = ({ memoryId, run, generation }: IndexMessageTarget) =>
  and(
    eq(memory.id, memoryId),
    run === undefined ? undefined : eq(memory.indexRun, run),
    generation === undefined
      ? undefined
      : eq(memory.indexGeneration, generation)
  );
/**
 * The row a Claim was loaded from, still at its run: the owner, the
 * generation and the run, always all of them. Every Indexing write checks it.
 */
const claimed = ({ memoryId, userId, generation, run }: Claim) =>
  and(
    eq(memory.id, memoryId),
    eq(memory.userId, userId),
    eq(memory.indexGeneration, generation),
    eq(memory.indexRun, run)
  );
const indexing = eq(memory.indexState, "indexing");

const failed = (reason: IndexFailure) => ({
  indexState: "failed" as const,
  indexError: reason,
  indexLeaseUntil: null,
});

/**
 * A link's Source (normalised: no tracking parameters go to the Source or
 * a model) and what gathering found, for Indexing to read.
 */
const linkColumns = {
  sourceUrl: memory.sourceUrlNormalised,
  gathered: sql<boolean>`${memory.metadata} is not null and (${memory.kind} <> 'video' or ${memory.metadata}->'video' is not null)`,
  transcript: sql<
    TranscriptSegment[] | null
  >`${memory.metadata}->'video'->'transcript'`,
  pageTitle: sql<string | null>`${memory.metadata}->>'title'`,
  description: sql<string | null>`${memory.metadata}->>'description'`,
};

/** Only a Memory whose files are all stored can be Indexed. */
const allStored = sql`not exists (select 1 from memory_file f where f.memory_id = ${memory.id} and f.stored_at is null)`;

/**
 * Indexing's side of the database, for the queue consumer (not scoped to a
 * person: it acts on queue messages). Structurally the `IndexStore` of
 * @spark/indexing. Every write names the Claim it loaded (owner, generation
 * and run) and changes nothing once Indexing has moved on or the Memory is
 * not the one loaded, so duplicate or late messages are harmless. No
 * transaction is held across an AI call: each write is its own.
 */
export function indexingStore(db: Database) {
  /** An image Memory's original and thumbnail keys, for a model to read. */
  async function imageOf(id: string) {
    const files = await db
      .select({
        role: memoryFile.role,
        key: memoryFile.key,
        mime: memoryFile.mime,
        bytes: memoryFile.bytes,
      })
      .from(memoryFile)
      .where(eq(memoryFile.memoryId, id));
    const original = files.find((f) => f.role === "original");
    const thumbnail = files.find((f) => f.role === "thumbnail");
    if (!original || !thumbnail) return undefined;
    return {
      key: original.key,
      mime: original.mime,
      bytes: original.bytes,
      thumbnailKey: thumbnail.key,
      thumbnailMime: thumbnail.mime,
    };
  }

  /** A PDF's file and its stored page images, in order, for Indexing to read. */
  async function pdfOf(id: string) {
    const files = await db
      .select({
        role: memoryFile.role,
        page: memoryFile.page,
        key: memoryFile.key,
        mime: memoryFile.mime,
        bytes: memoryFile.bytes,
        pages: memoryFile.pages,
      })
      .from(memoryFile)
      .where(eq(memoryFile.memoryId, id))
      .orderBy(memoryFile.page);
    const original = files.find((f) => f.role === "original");
    if (!original) return undefined;
    return {
      key: original.key,
      bytes: original.bytes,
      pages: original.pages ?? 0,
      pageImages: files
        .filter((f) => f.role === "page")
        .map(({ page, key, mime }) => ({ page, key, mime })),
    };
  }

  /** A file Memory's files, as Indexing reads them. */
  async function filesOf(id: string, kind: MemoryKind) {
    if (kind === "image") {
      const image = await imageOf(id);
      return image && { image };
    }
    if (kind === "pdf") {
      const pdf = await pdfOf(id);
      return pdf && { pdf };
    }
    return undefined;
  }

  return {
    /**
     * Automatic Categories for the Memory at `revision`, once: never over a
     * user's edit (Locked categories), AI opt-out, a newer revision or run.
     */
    async writeCategories(claim: Claim, revision: number, input: unknown) {
      const categories = Categories.parse(input);
      const rows = await db
        .update(memory)
        .set({ categories, categoriesRevision: revision })
        .where(
          and(
            claimed(claim),
            eq(memory.revision, revision),
            eq(memory.aiOptOut, false),
            categoriesStale
          )
        )
        .returning({ id: memory.id });
      return rows.length > 0;
    },
    /**
     * Takes a Memory waiting for Indexing (at `run` and `generation`, when
     * given) and leases it for LEASE_MINUTES. Undefined when it is gone, not
     * waiting, at another run or generation, or leased by another delivery
     * of the same work.
     */
    async load(id: string, run?: number, generation?: string) {
      const [row] = await db
        .update(memory)
        .set({ ...lease(), indexLeaseRun: sql`${memory.indexRun}` })
        .where(
          and(
            named({ memoryId: id, run, generation }),
            indexing,
            unleased,
            allStored
          )
        )
        .returning({
          userId: memory.userId,
          generation: memory.indexGeneration,
          kind: memory.kind,
          run: memory.indexRun,
          revision: memory.revision,
          categoriesStale,
          title: memory.title,
          body: memory.body,
          captureNote: memory.captureNote,
          aiOptOut: memory.aiOptOut,
          ...linkColumns,
        });
      if (!row) return row;
      return { ...row, ...(await filesOf(id, row.kind)) };
    },

    /**
     * A PDF's own text, as `toMarkdown` read it (pages apart by form
     * feeds), kept once as its Preserved text for the Claim's run: like a
     * link's, it is the document's words, not a model's, so it stays with
     * AI opt-out. False when the run moved on or it was kept already.
     */
    async savePdfText(claim: Claim, text: string) {
      const rows = await db
        .update(memory)
        .set({ body: text })
        .where(
          and(
            claimed(claim),
            indexing,
            eq(memory.kind, "pdf"),
            sql`${memory.body} is null`
          )
        )
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /**
     * What gathering a link found, kept once for the Claim's run: the
     * page's metadata and, as the Preserved copy, its text (the Memory is
     * Preserved with text, Reference only without). A content hash another
     * of the owner's links already has is not kept, so both stay. Returns
     * the Memory's content as Extraction should now see it; undefined when
     * the run moved on or it was gathered already.
     */
    async saveGathered(
      claim: Claim,
      gathered: {
        metadata: LinkMetadata;
        text: string | null;
        contentHash?: string;
      }
    ) {
      const write = async (hash: string | null) => {
        const [row] = await db
          .update(memory)
          .set({
            metadata: sql`coalesce(${memory.metadata}, '{}'::jsonb) || ${JSON.stringify(gathered.metadata)}::jsonb`,
            body: gathered.text,
            preservation: sql`case when ${memory.kind} = 'video' then 'reference_only' when ${gathered.text}::text is not null then 'preserved' else 'reference_only' end`,
            contentHash: sql`case when exists (
              select 1 from memory o where o.user_id = ${memory.userId}
                and o.kind = 'link' and o.content_hash = ${hash}::text
                and o.id <> ${memory.id}) then null else ${hash}::text end`,
          })
          .where(
            and(
              claimed(claim),
              indexing,
              sql`${memory.kind} in ('link', 'video')`,
              sql`(${memory.metadata} is null or (${memory.kind} = 'video' and ${memory.metadata}->'video' is null))`
            )
          )
          .returning({
            title: memory.title,
            body: memory.body,
            captureNote: memory.captureNote,
            ...linkColumns,
          });
        return row;
      };
      try {
        return await write(gathered.contentHash ?? null);
      } catch (error) {
        // Another link with this text was gathered at the same moment.
        if ((error as { cause?: { code?: string } }).cause?.code !== "23505") {
          throw error;
        }
        return write(null);
      }
    },

    /**
     * Searchable, with what was found (null: AI opt-out, nothing was sent)
     * and its vectors, kept only if the text they were made from has not
     * been edited since (else the hourly sweep makes them again).
     */
    async complete(
      claim: Claim,
      extraction: { output: IndexingOutput; model: string } | null,
      embedding?: Embedding
    ): Promise<boolean> {
      const id = claim.memoryId;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(memory)
          .set({
            indexState: "searchable",
            indexError: null,
            indexLeaseUntil: null,
            ...(extraction && { language: extraction.output.language }),
          })
          .where(
            and(
              claimed(claim),
              indexing,
              // A result from a model is never kept for AI opt-out.
              extraction ? eq(memory.aiOptOut, false) : undefined
            )
          )
          .returning({
            id: memory.id,
            userId: memory.userId,
            revision: memory.revision,
          });
        if (!row || !extraction) return !!row;
        const { language: _, ...found } = extraction.output;
        const values = {
          ...found,
          model: extraction.model,
          indexedAt: sql`now()`,
        };
        await tx
          .insert(memoryIndex)
          .values({ memoryId: id, ...values })
          .onConflictDoUpdate({ target: memoryIndex.memoryId, set: values });
        if (embedding && embedding.revision === row.revision) {
          await replaceVectors(tx, id, row.userId, embedding);
        }
        return true;
      });
    },

    /**
     * Takes a Searchable Memory whose vectors in `space` are stale, with
     * what Indexing found, under the same lease as `load`. Undefined when it
     * is gone, has AI opt-out, is not stale, or is taken.
     */
    async loadForEmbedding(id: string, space: string, generation?: string) {
      const [row] = await db
        .update(memory)
        .set({ ...lease(), indexLeaseRun: sql`${memory.indexRun}` })
        .where(
          and(
            named({ memoryId: id, generation }),
            embeddable,
            staleIn(space),
            unleased
          )
        )
        .returning({
          userId: memory.userId,
          generation: memory.indexGeneration,
          kind: memory.kind,
          run: memory.indexRun,
          revision: memory.revision,
          categoriesStale,
          vectorsCurrent: sql<boolean>`not ${vectorsStaleIn(space)}`,
          title: memory.title,
          body: memory.body,
          captureNote: memory.captureNote,
          transcript: linkColumns.transcript,
        });
      if (!row) return undefined;
      const { vectorsCurrent, ...loaded } = row;
      const [found] = await db
        .select({
          title: memoryIndex.title,
          description: memoryIndex.description,
          ocrText: memoryIndex.ocrText,
          tags: memoryIndex.tags,
          entities: memoryIndex.entities,
        })
        .from(memoryIndex)
        .where(eq(memoryIndex.memoryId, id));
      if (!found) return undefined;
      // Only Categories are due: they are made from the vector already kept.
      const [kept] = vectorsCurrent
        ? await db
            .select({ embedding: memoryVector.embedding })
            .from(memoryVector)
            .where(
              and(
                eq(memoryVector.memoryId, id),
                eq(memoryVector.kind, "overview")
              )
            )
        : [];
      return {
        ...loaded,
        found,
        overview: kept?.embedding,
        ...(await filesOf(id, row.kind)),
      };
    },

    /**
     * Whether the Memory loaded is still Searchable at the Claim's run and
     * `revision`, without AI opt-out: asked right before the embedding
     * call. Renews the lease.
     */
    async stillEmbeddable(claim: Claim, revision: number) {
      const [row] = await db
        .update(memory)
        .set(lease())
        .where(and(claimed(claim), eq(memory.revision, revision), embeddable))
        .returning({ id: memory.id });
      return !!row;
    },

    /** New vectors for a Searchable Memory, if nothing changed since loading. */
    async writeVectors(claim: Claim, embedding: Embedding) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(memory)
          .set({ indexLeaseUntil: null })
          .where(
            and(
              claimed(claim),
              eq(memory.revision, embedding.revision),
              embeddable
            )
          )
          .returning({ userId: memory.userId });
        if (!row) return false;
        await replaceVectors(tx, claim.memoryId, row.userId, embedding);
        return true;
      });
    },

    /** Memories whose vectors in `space` are missing or stale, oldest first. */
    async staleVectors(space: string, limit: number = EMBEDDING.sweepBatch) {
      return db
        .select({ id: memory.id, generation: memory.indexGeneration })
        .from(memory)
        .where(and(embeddable, staleIn(space), unleased))
        .orderBy(memory.updatedAt)
        .limit(limit);
    },

    /** Failed with `reason`, if the Claim is still current. */
    async fail(claim: Claim, reason: IndexFailure) {
      const rows = await db
        .update(memory)
        .set(failed(reason))
        .where(and(claimed(claim), indexing))
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /**
     * Failed as unavailable: a message the queue gave up on (the
     * dead-letter queue), for the run and Memory it was sent for. A message
     * from before generations were sent cannot say which Memory it was for
     * (a new one with its id restarts at run 1), so it changes nothing: the
     * hourly sweep sends whatever is still Indexing again.
     */
    async giveUp(message: IndexMessageTarget) {
      if (message.generation === undefined) return false;
      const rows = await db
        .update(memory)
        .set(failed("unavailable"))
        .where(and(named(message), indexing))
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /** Gives the lease back, for the next attempt of the same message. */
    async release(claim: Claim) {
      await db
        .update(memory)
        .set({ indexLeaseUntil: null })
        .where(claimed(claim));
    },

    /**
     * Whether `run` is still the one to work on, without AI opt-out: asked
     * again right before each provider call, so switching AI opt-out on
     * mid-flight stops any call not yet made. Renews the lease, so a long
     * chain never loses it.
     */
    async isCurrent(claim: Claim): Promise<boolean> {
      // Still working on it: the lease runs from now again.
      const [row] = await db
        .update(memory)
        .set(lease())
        .where(and(claimed(claim), indexing, eq(memory.aiOptOut, false)))
        .returning({ id: memory.id });
      return !!row;
    },

    async spentTodayMicros(): Promise<number> {
      const [row] = await db
        .select({
          micros: sql<string>`coalesce(sum(${spendDay.costMicros}), 0)`,
        })
        .from(spendDay)
        .where(eq(spendDay.day, today));
      return Number(row?.micros ?? 0);
    },

    /** The admin's daily budget, or the config default when they have not set one. */
    dailyBudgetMicros: () => readDailyBudgetMicros(db),

    /**
     * Claims the first time this Memory became Searchable. One update wins
     * when several runs finish together. Later runs find the timestamp set
     * and return nothing, so an edit, Retry or budget-delayed run does not
     * send the event again. The duration is a bigint: an int overflows after
     * about 24 days. Nothing is returned when the Capture opted out, but the
     * timestamp is still set so a later change cannot emit a skewed event.
     * Kind and duration only: no title, text or email. Only the Memory of
     * `generation` is claimed, never a later one with its id.
     */
    async claimFirstSearchable(
      id: string,
      generation: string
    ): Promise<
      { userId: string; kind: MemoryKind; milliseconds: number } | undefined
    > {
      const { rows } = await db.execute<{
        user_id: string;
        kind: MemoryKind;
        product_analytics: boolean;
        milliseconds: string;
      }>(sql`
        update memory
        set first_searchable_at = clock_timestamp()
        where id = ${id}
          and index_generation = ${generation}
          and index_state = 'searchable'
          and first_searchable_at is null
        returning user_id, kind, product_analytics,
          greatest(
            0,
            floor(extract(epoch from (first_searchable_at - captured_at)) * 1000)
          )::bigint as milliseconds
      `);
      const row = rows[0];
      if (!row?.product_analytics) return undefined;
      return {
        userId: row.user_id,
        kind: row.kind,
        milliseconds: Number(row.milliseconds),
      };
    },

    /**
     * One AI call: its own row, and today's total, added to atomically. The
     * row names its owner and its Memory only while they exist and the owner
     * is not being deleted (a call can finish after its Memory, or its
     * owner, is gone), checked under the owner's lock, which the deletion's
     * final step holds too.
     */
    async recordCall(call: {
      userId: string;
      /** Null for a search query's embedding. */
      memoryId: string | null;
      /** The Memory's generation, so the row names it even once the id is reused. */
      memoryGeneration?: string;
      provider: ProviderName;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
      costMicros: number;
      /** A guess (the call timed out with no usage), kept apart in reports. */
      estimated?: boolean;
    }) {
      await db.transaction(async (tx) => {
        await lockOwner(tx, call.userId);
        const ownerNamed = sql`exists (select 1 from ${user} where ${user.id} = ${call.userId}) and not exists (select 1 from ${accountDeletion} where ${accountDeletion.userId} = ${call.userId})`;
        await tx.insert(aiCall).values({
          userId: sql`case when ${ownerNamed} then ${call.userId} else ${ANONYMISED_USER} end`,
          memoryId: sql`case when ${ownerNamed} then ${call.memoryId}::uuid else null end`,
          memoryGeneration: sql`case when ${ownerNamed} then ${call.memoryGeneration ?? null}::uuid else null end`,
          day: today,
          provider: call.provider,
          model: call.model,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
          costMicros: call.costMicros,
          estimated: call.estimated ?? false,
        });
        await tx
          .insert(spendDay)
          .values({
            day: today,
            provider: call.provider,
            costMicros: call.costMicros,
          })
          .onConflictDoUpdate({
            target: [spendDay.day, spendDay.provider],
            set: {
              costMicros: sql`${spendDay.costMicros} + excluded.cost_micros`,
            },
          });
      });
    },

    /**
     * Memories Indexing for longer than `minutes` (a message lost or never
     * sent), oldest first, to enqueue again.
     */
    async stalled(
      minutes = 60,
      limit = 500,
      freshOnly = false
    ): Promise<
      {
        id: string;
        run: number;
        generation: string;
        priority: "fresh" | "background";
      }[]
    > {
      return db
        .select({
          id: memory.id,
          run: memory.indexRun,
          generation: memory.indexGeneration,
          priority: memory.indexPriority,
        })
        .from(memory)
        .where(
          and(
            eq(memory.indexState, "indexing"),
            lt(
              memory.updatedAt,
              sql`now() - make_interval(mins => ${minutes})`
            ),
            unleased,
            allStored,
            freshOnly ? eq(memory.indexPriority, "fresh") : undefined
          )
        )
        .orderBy(memory.updatedAt)
        .limit(limit);
    },
  };
}

export type IndexingStore = ReturnType<typeof indexingStore>;
