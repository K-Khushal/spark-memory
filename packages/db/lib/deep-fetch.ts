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
import { lockOwner } from "./owner";
import { textFits } from "./storage";
import { accountDeletion, deepFetchUsage, memory, usageDay } from "./schema";

/**
 * The row a Deep fetch attempt took (structurally @spark/deep-fetch's
 * Claim). Every write names all of it and does nothing once Try Again has
 * started a new run, the Memory was deleted, another saved with its id, or
 * the lease ran out and a later worker took the row.
 */
export type DeepFetchClaim = {
  memoryId: string;
  userId: string;
  /** The Memory's `indexGeneration`: set once, never reused for the id. */
  generation: string;
  /** `deepFetchRun`: Try Again starts another. */
  run: number;
  /** The lease this attempt holds: a later lease has another, and wins. */
  token: string;
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

const claimed = ({
  memoryId,
  userId,
  generation,
  run,
  token,
}: DeepFetchClaim) =>
  and(
    eq(memory.id, memoryId),
    eq(memory.userId, userId),
    eq(memory.indexGeneration, generation),
    eq(memory.deepFetchRun, run),
    eq(memory.deepFetchState, "running"),
    eq(memory.deepFetchToken, token),
    eq(memory.overAllowance, false)
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
      .set({ deepFetchLeaseUntil: null, deepFetchToken: null, ...set })
      .where(claimed(claim))
      .returning({ id: memory.id });
    return rows.length > 0;
  };

  return {
    /**
     * Takes a Memory whose Deep fetch is due (queued and past its due time,
     * or running with a lease that ran out) at this run and generation,
     * under a new lease token, and counts the attempt: a worker that dies
     * mid-fetch has still used one. A Memory whose lease ran out with every
     * attempt used is Failed instead of taken, so a job that always crashes
     * does not run for ever. `attempts` is this attempt's number.
     */
    async claim(memoryId: string, generation: string, run: number) {
      // Captured over the Free allowance: no AI work, so none that restarts it.
      const whose = and(
        eq(memory.id, memoryId),
        eq(memory.indexGeneration, generation),
        eq(memory.deepFetchRun, run),
        eq(memory.overAllowance, false)
      );
      await db
        .update(memory)
        .set({
          deepFetchState: "failed",
          deepFetchError: "error",
          deepFetchDueAt: null,
          deepFetchLeaseUntil: null,
          deepFetchToken: null,
        })
        .where(
          and(
            whose,
            eq(memory.deepFetchState, "running"),
            sql`${memory.deepFetchLeaseUntil} < now()`,
            sql`${memory.deepFetchAttempts} >= ${DEEP_FETCH.maxAttempts}`
          )
        );
      const [row] = await db
        .update(memory)
        .set({
          deepFetchState: "running",
          deepFetchLeaseUntil: sql`now() + make_interval(mins => ${DEEP_FETCH.leaseMinutes})`,
          deepFetchToken: sql`gen_random_uuid()`,
          deepFetchAttempts: sql`${memory.deepFetchAttempts} + 1`,
        })
        .where(
          and(
            whose,
            inArray(memory.kind, ["link", "video"]),
            isNotNull(memory.sourceUrlNormalised),
            isDue,
            sql`${memory.deepFetchAttempts} < ${DEEP_FETCH.maxAttempts}`,
            sql`not exists (select 1 from ${accountDeletion} d where d.user_id = ${memory.userId})`
          )
        )
        .returning({
          userId: memory.userId,
          kind: memory.kind,
          url: memory.sourceUrlNormalised,
          aiOptOut: memory.aiOptOut,
          attempts: memory.deepFetchAttempts,
          token: memory.deepFetchToken,
        });
      if (!row?.url || !row.token) return undefined;
      const claim: DeepFetchClaim = {
        memoryId,
        userId: row.userId,
        generation,
        run,
        token: row.token,
      };
      return {
        claim,
        kind: row.kind as MemoryKind,
        url: row.url,
        aiOptOut: row.aiOptOut,
        attempts: row.attempts,
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
      return db.transaction(async (tx) => {
        // What it found takes storage like any text: under the owner's lock,
        // with no room for it nothing of it is kept (the job is still done)
        // and the Memory ends partly Indexed, never failed.
        let keep = found;
        let full = false;
        if (found) {
          await lockOwner(tx, claim.userId);
          const body = (
            await tx
              .select({ body: memory.body })
              .from(memory)
              .where(eq(memory.id, claim.memoryId))
          )[0]?.body;
          const bodyAfter =
            text !== null &&
            (body === null || (body?.length ?? 0) < text.length)
              ? text
              : undefined;
          const fits =
            bodyAfter === undefined ||
            (await textFits(tx, claim.userId, claim.memoryId, {
              body: bodyAfter,
            }));
          if (!fits) {
            keep = undefined;
            full = true;
          }
        }
        const [row] = await tx
          .update(memory)
          .set({
            deepFetchState: "done",
            deepFetchError: null,
            deepFetchLeaseUntil: null,
            deepFetchToken: null,
            ...(full && {
              indexState: "searchable",
              indexError: null,
              indexLeaseUntil: null,
              overAllowance: true,
            }),
            ...(keep && {
              // Metadata the page already had stays; the patch (a video's
              // transcript) replaces what was empty.
              metadata: sql`(${JSON.stringify(keep.metadata ?? {})}::jsonb || coalesce(${memory.metadata}, '{}'::jsonb)) || ${video}`,
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
        return row && { ...row, reindex: !!keep };
      });
    },

    /**
     * Try again after `delaySeconds`. `attempt` false gives back the attempt
     * the claim counted: it waited for a limit and never asked an engine.
     */
    retry: (
      claim: DeepFetchClaim,
      { delaySeconds, attempt }: { delaySeconds: number; attempt: boolean }
    ) =>
      settle(claim, {
        deepFetchState: "queued",
        deepFetchDueAt: sql`now() + make_interval(secs => ${delaySeconds})`,
        ...(!attempt && {
          deepFetchAttempts: sql`greatest(0, ${memory.deepFetchAttempts} - 1)`,
        }),
      }),

    /** Failed for good (Try Again starts it over). */
    fail: (claim: DeepFetchClaim, error: DeepFetchFailure) =>
      settle(claim, {
        deepFetchState: "failed",
        deepFetchError: error,
        deepFetchDueAt: null,
      }),

    /** No engine is set up for this kind: nothing was tried, so the attempt is given back. */
    unavailable: (claim: DeepFetchClaim) =>
      settle(claim, {
        deepFetchState: "unavailable",
        deepFetchError: null,
        deepFetchDueAt: null,
        deepFetchAttempts: sql`greatest(0, ${memory.deepFetchAttempts} - 1)`,
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
        .where(and(isDue, eq(memory.overAllowance, false)))
        .orderBy(memory.deepFetchDueAt)
        .limit(limit);
      return rows.map((r) => ({ ...r, delaySeconds: 0 }));
    },
  };
}

export type DeepFetchStore = ReturnType<typeof deepFetchStore>;
