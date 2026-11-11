import { and, eq, lt, sql } from "drizzle-orm";
import type { IndexFailure, IndexingOutput, ProviderName } from "@spark/core";
import type { Database } from "./client";
import { aiCall, memory, memoryFile, memoryIndex, spendDay } from "./schema";

/** Today in UTC, by the database's clock: the day the budget counts. */
const today = sql`(now() at time zone 'utc')::date`;

/** Longer than any one message's provider calls take. */
const LEASE_MINUTES = 5;
const unleased = sql`(${memory.indexLeaseUntil} is null or ${memory.indexLeaseUntil} < now())`;

/** Only a Memory whose files are all stored can be Indexed. */
const allStored = sql`not exists (select 1 from memory_file f where f.memory_id = ${memory.id} and f.stored_at is null)`;

/**
 * Indexing's side of the database, for the queue consumer (not scoped to a
 * person: it acts on queue messages). Structurally the `IndexStore` of
 * @spark/indexing. Every write names the run it read and changes nothing
 * once Indexing has moved on, so duplicate or late messages are harmless.
 * No transaction is held across an AI call: each write is its own.
 */
export function indexingStore(db: Database) {
  const atRun = (id: string, run: number) =>
    and(
      eq(memory.id, id),
      eq(memory.indexRun, run),
      eq(memory.indexState, "indexing")
    );

  return {
    /**
     * Takes a Memory waiting for Indexing (at `run`, when given) and leases
     * it for LEASE_MINUTES. Undefined when it is gone, not waiting, at
     * another run, or leased by another delivery of the same work.
     */
    async load(id: string, run?: number) {
      const [row] = await db
        .update(memory)
        .set({
          indexLeaseUntil: sql`now() + make_interval(mins => ${LEASE_MINUTES})`,
        })
        .where(
          and(
            eq(memory.id, id),
            eq(memory.indexState, "indexing"),
            run === undefined ? undefined : eq(memory.indexRun, run),
            unleased,
            allStored
          )
        )
        .returning({
          userId: memory.userId,
          kind: memory.kind,
          run: memory.indexRun,
          title: memory.title,
          body: memory.body,
          captureNote: memory.captureNote,
          aiOptOut: memory.aiOptOut,
        });
      if (!row) return undefined;
      if (row.kind !== "image") return row;
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
      if (!original || !thumbnail) return row;
      return {
        ...row,
        image: {
          key: original.key,
          mime: original.mime,
          bytes: original.bytes,
          thumbnailKey: thumbnail.key,
          thumbnailMime: thumbnail.mime,
        },
      };
    },

    /** Searchable, with what was found (null: AI opt-out, nothing was sent). */
    async complete(
      id: string,
      run: number,
      extraction: { output: IndexingOutput; model: string } | null
    ): Promise<boolean> {
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
              atRun(id, run),
              // A result from a model is never kept for AI opt-out.
              extraction ? eq(memory.aiOptOut, false) : undefined
            )
          )
          .returning({ id: memory.id });
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
        return true;
      });
    },

    /**
     * Failed with `reason`. Without `run` (a message the queue gave up on,
     * from before runs were in messages) whatever run is current fails.
     */
    async fail(id: string, run: number | undefined, reason: IndexFailure) {
      const rows = await db
        .update(memory)
        .set({
          indexState: "failed",
          indexError: reason,
          indexLeaseUntil: null,
        })
        .where(
          run === undefined
            ? and(eq(memory.id, id), eq(memory.indexState, "indexing"))
            : atRun(id, run)
        )
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /** Gives the lease back, for the next attempt of the same message. */
    async release(id: string, run: number) {
      await db
        .update(memory)
        .set({ indexLeaseUntil: null })
        .where(atRun(id, run));
    },

    /**
     * Whether `run` is still the one to work on, without AI opt-out: asked
     * again right before each provider call, so switching AI opt-out on
     * mid-flight stops any call not yet made.
     */
    async isCurrent(id: string, run: number): Promise<boolean> {
      const [row] = await db
        .select({ id: memory.id })
        .from(memory)
        .where(and(atRun(id, run), eq(memory.aiOptOut, false)));
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

    /** One AI call: its own row, and today's total, added to atomically. */
    async recordCall(call: {
      userId: string;
      memoryId: string;
      provider: ProviderName;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
      costMicros: number;
    }) {
      await db.transaction(async (tx) => {
        await tx.insert(aiCall).values({
          userId: call.userId,
          memoryId: call.memoryId,
          day: today,
          provider: call.provider,
          model: call.model,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
          costMicros: call.costMicros,
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
      limit = 500
    ): Promise<{ id: string; run: number }[]> {
      return db
        .select({ id: memory.id, run: memory.indexRun })
        .from(memory)
        .where(
          and(
            eq(memory.indexState, "indexing"),
            lt(
              memory.updatedAt,
              sql`now() - make_interval(mins => ${minutes})`
            ),
            unleased,
            allStored
          )
        )
        .orderBy(memory.updatedAt)
        .limit(limit);
    },
  };
}

export type IndexingStore = ReturnType<typeof indexingStore>;
