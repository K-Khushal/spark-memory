import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
  DEEP_FETCH,
  type DeepFetchEngine,
  type DeepFetchFailure,
  type LinkMetadata,
  type MemoryKind,
  type TranscriptSegment,
} from "@spark/core";
import type { Database } from "./client";
import { accountDeletion, deepFetchUsage, memory, usageDay } from "./schema";

/**
 * The row a Deep fetch attempt took (structurally @spark/deep-fetch's
 * Claim). Every write names all of it and does nothing once Try Again has
 * started a new run, the Memory was deleted, or another saved with its id.
 */
export type DeepFetchClaim = {
  memoryId: string;
  userId: string;
  /** The Memory's `indexGeneration`: set once, never reused for the id. */
  generation: string;
  /** `deepFetchRun`: Try Again starts another. */
  run: number;
};

/** A queue message's worth: which Memory, at which run, and how long until it is due. */
export type DeepFetchTarget = {
  memoryId: string;
  generation: string;
  run: number;
  delaySeconds: number;
};

/** What an attempt found, kept on the Memory. */
export type DeepFetched = {
  /** A page's readable text: the Preserved copy of a link. */
  text?: string;
  /** What the page says about itself; only missing fields are filled. */
  metadata?: LinkMetadata;
  /** A video's timestamped transcript. */
  transcript?: TranscriptSegment[];
};

const today = sql`(now() at time zone 'utc')::date`;

const claimed = ({ memoryId, userId, generation, run }: DeepFetchClaim) =>
  and(
    eq(memory.id, memoryId),
    eq(memory.userId, userId),
    eq(memory.indexGeneration, generation),
    eq(memory.deepFetchRun, run),
    eq(memory.deepFetchState, "running")
  );

/** Queued and past its due time, or running on a lease that ran out. */
const isDue = sql`((${memory.deepFetchState} = 'queued' and ${memory.deepFetchDueAt} <= now())
  or (${memory.deepFetchState} = 'running' and ${memory.deepFetchLeaseUntil} < now()))`;

const delayOf = sql<number>`greatest(0, ceil(extract(epoch from (${memory.deepFetchDueAt} - now()))))::int`;

/**
 * Deep fetch's side of the database, for the queue consumer (not scoped to a
 * person: it acts on queue messages). Every write names the Claim it took.
 * No lock or transaction is held across a network call: an attempt is a
 * lease (`DEEP_FETCH.leaseMinutes`) that expires if its consumer dies.
 */
export function deepFetchStore(db: Database) {
  const settle = async (
    claim: DeepFetchClaim,
    set: PgUpdateSetSource<typeof memory>
  ) => {
    const rows = await db
      .update(memory)
      .set({ deepFetchLeaseUntil: null, ...set })
      .where(claimed(claim))
      .returning({ id: memory.id });
    return rows.length > 0;
  };

  return {
    /**
     * Takes a Memory whose Deep fetch is due (queued and past its due time,
     * or running with a lease that ran out) at this run and generation.
     */
    async claim(memoryId: string, generation: string, run: number) {
      const [row] = await db
        .update(memory)
        .set({
          deepFetchState: "running",
          deepFetchLeaseUntil: sql`now() + make_interval(mins => ${DEEP_FETCH.leaseMinutes})`,
        })
        .where(
          and(
            eq(memory.id, memoryId),
            eq(memory.indexGeneration, generation),
            eq(memory.deepFetchRun, run),
            inArray(memory.kind, ["link", "video"]),
            isNotNull(memory.sourceUrlNormalised),
            isDue,
            sql`not exists (select 1 from ${accountDeletion} d where d.user_id = ${memory.userId})`
          )
        )
        .returning({
          userId: memory.userId,
          kind: memory.kind,
          url: memory.sourceUrlNormalised,
          aiOptOut: memory.aiOptOut,
          attempts: memory.deepFetchAttempts,
          hasText: sql<boolean>`${memory.body} is not null`,
        });
      if (!row?.url) return undefined;
      const claim: DeepFetchClaim = {
        memoryId,
        userId: row.userId,
        generation,
        run,
      };
      return {
        claim,
        kind: row.kind as MemoryKind,
        url: row.url,
        aiOptOut: row.aiOptOut,
        attempts: row.attempts,
        /** The Memory already has text: Deep fetch is for what is missing. */
        hasText: row.hasText,
      };
    },

    /**
     * Counts one Deep fetch against the person's day (`perDay`); false once
     * they have used them all.
     */
    async takeSlot(userId: string, perDay: number = DEEP_FETCH.perDay) {
      const rows = await db
        .insert(usageDay)
        .values({ userId, day: today, deepFetches: 1 })
        .onConflictDoUpdate({
          target: [usageDay.userId, usageDay.day],
          set: { deepFetches: sql`${usageDay.deepFetches} + 1` },
          setWhere: sql`${usageDay.deepFetches} < ${perDay}`,
        })
        .returning({ n: usageDay.deepFetches });
      return rows.length > 0;
    },

    /** Gives a slot back: the engine never ran (it was out of free tier). */
    async giveBackSlot(userId: string) {
      await db
        .update(usageDay)
        .set({ deepFetches: sql`greatest(0, ${usageDay.deepFetches} - 1)` })
        .where(and(eq(usageDay.userId, userId), eq(usageDay.day, today)));
    },

    /** Seconds the engine has spent of its free tier in `window` (`budgetWindow`). */
    async usedSeconds(engine: DeepFetchEngine, window: string) {
      const [row] = await db
        .select({ seconds: deepFetchUsage.seconds })
        .from(deepFetchUsage)
        .where(
          and(
            eq(deepFetchUsage.engine, engine),
            eq(deepFetchUsage.window, window)
          )
        );
      return row?.seconds ?? 0;
    },

    async addSeconds(engine: DeepFetchEngine, window: string, seconds: number) {
      await db
        .insert(deepFetchUsage)
        .values({ engine, window, seconds })
        .onConflictDoUpdate({
          target: [deepFetchUsage.engine, deepFetchUsage.window],
          set: { seconds: sql`${deepFetchUsage.seconds} + excluded.seconds` },
        });
    },

    /**
     * Done. With `found`, the text, metadata and transcript are kept (a
     * link with text is Preserved; a video stays Reference only) and
     * Indexing starts over as a new background run, which the daily AI
     * budget limits: the target to enqueue comes back. Without it (only a
     * screenshot came back) nothing else changes. Undefined when the claim
     * is stale.
     */
    async done(claim: DeepFetchClaim, found?: DeepFetched) {
      const text = found?.text ?? null;
      // The video marker keeps what Gather stored (its duration) and gains the transcript.
      const video = found?.transcript
        ? sql`jsonb_build_object('video', coalesce(${memory.metadata}->'video', '{}'::jsonb) || ${JSON.stringify({ transcript: found.transcript, transcriptState: "available" })}::jsonb)`
        : sql`'{}'::jsonb`;
      const [row] = await db
        .update(memory)
        .set({
          deepFetchState: "done",
          deepFetchError: null,
          deepFetchLeaseUntil: null,
          ...(found && {
            // Metadata the page already had stays; the patch (a video's
            // transcript) replaces what was empty.
            metadata: sql`(${JSON.stringify(found.metadata ?? {})}::jsonb || coalesce(${memory.metadata}, '{}'::jsonb)) || ${video}`,
            body: sql`case when ${text}::text is not null and (${memory.body} is null or char_length(${memory.body}) < char_length(${text}::text)) then ${text}::text else ${memory.body} end`,
            preservation: sql`case when ${memory.kind} = 'link' and (${memory.body} is not null or ${text}::text is not null) then 'preserved' else ${memory.preservation} end`,
            indexState: "indexing",
            indexError: null,
            indexRun: sql`${memory.indexRun} + 1`,
            indexPriority: "background",
            indexLeaseUntil: null,
          }),
        })
        .where(claimed(claim))
        .returning({
          id: memory.id,
          indexRun: memory.indexRun,
          indexGeneration: memory.indexGeneration,
          indexPriority: memory.indexPriority,
        });
      return row && { ...row, reindex: !!found };
    },

    /** Try again after `delaySeconds`; `attempt` counts it as one of the automatic attempts. */
    retry: (
      claim: DeepFetchClaim,
      { delaySeconds, attempt }: { delaySeconds: number; attempt: boolean }
    ) =>
      settle(claim, {
        deepFetchState: "queued",
        deepFetchDueAt: sql`now() + make_interval(secs => ${delaySeconds})`,
        ...(attempt && {
          deepFetchAttempts: sql`${memory.deepFetchAttempts} + 1`,
        }),
      }),

    /** Failed for good (Try Again starts it over). */
    fail: (claim: DeepFetchClaim, error: DeepFetchFailure) =>
      settle(claim, {
        deepFetchState: "failed",
        deepFetchError: error,
        deepFetchDueAt: null,
        deepFetchAttempts: sql`${memory.deepFetchAttempts} + 1`,
      }),

    /** No engine is configured for this kind: nothing was tried. */
    unavailable: (claim: DeepFetchClaim) =>
      settle(claim, {
        deepFetchState: "unavailable",
        deepFetchError: null,
        deepFetchDueAt: null,
      }),

    /** Deep fetch no longer applies (AI opt-out was switched on): nothing to show. */
    stop: (claim: DeepFetchClaim) =>
      settle(claim, { deepFetchState: null, deepFetchDueAt: null }),

    /**
     * What to send right after Indexing: this Memory's Deep fetch if it is
     * queued and no attempt is running. Undefined when there is none.
     */
    async pending(
      memoryId: string,
      generation: string
    ): Promise<DeepFetchTarget | undefined> {
      const [row] = await db
        .select({ run: memory.deepFetchRun, delaySeconds: delayOf })
        .from(memory)
        .where(
          and(
            eq(memory.id, memoryId),
            eq(memory.indexGeneration, generation),
            eq(memory.deepFetchState, "queued"),
            sql`(${memory.deepFetchLeaseUntil} is null or ${memory.deepFetchLeaseUntil} < now())`
          )
        );
      return row && { memoryId, generation, ...row };
    },

    /**
     * Memories whose Deep fetch is due (queued and past due, or running on
     * a lease that ran out), oldest first: the hourly sweep sends them, so a
     * lost or too-long-delayed message costs at most an hour.
     */
    async due(
      limit: number = DEEP_FETCH.sweepBatch
    ): Promise<DeepFetchTarget[]> {
      const rows = await db
        .select({
          memoryId: memory.id,
          generation: memory.indexGeneration,
          run: memory.deepFetchRun,
        })
        .from(memory)
        .where(isDue)
        .orderBy(memory.deepFetchDueAt)
        .limit(limit);
      return rows.map((r) => ({ ...r, delaySeconds: 0 }));
    },
  };
}

export type DeepFetchStore = ReturnType<typeof deepFetchStore>;
