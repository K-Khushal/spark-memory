import { and, eq, lt, sql } from "drizzle-orm";
import type { IndexFailure, IndexingOutput, ProviderName } from "@spark/core";
import type { Database } from "./client";
import { aiCall, memory, memoryFile, memoryIndex, spendDay } from "./schema";

/** Today in UTC, by the database's clock: the day the budget counts. */
const today = sql`(now() at time zone 'utc')::date`;

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
    async load(id: string) {
      const [row] = await db
        .select({
          userId: memory.userId,
          kind: memory.kind,
          run: memory.indexRun,
          title: memory.title,
          body: memory.body,
          captureNote: memory.captureNote,
          aiOptOut: memory.aiOptOut,
        })
        .from(memory)
        .where(
          and(eq(memory.id, id), eq(memory.indexState, "indexing"), allStored)
        );
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

    async fail(id: string, run: number, reason: IndexFailure) {
      const rows = await db
        .update(memory)
        .set({ indexState: "failed", indexError: reason })
        .where(atRun(id, run))
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /** Fails whatever run is current: for a message the queue gave up on. */
    async failCurrent(id: string, reason: IndexFailure) {
      await db
        .update(memory)
        .set({ indexState: "failed", indexError: reason })
        .where(and(eq(memory.id, id), eq(memory.indexState, "indexing")));
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
    async stalled(minutes = 60, limit = 500): Promise<string[]> {
      const rows = await db
        .select({ id: memory.id })
        .from(memory)
        .where(
          and(
            eq(memory.indexState, "indexing"),
            lt(
              memory.updatedAt,
              sql`now() - make_interval(mins => ${minutes})`
            ),
            allStored
          )
        )
        .orderBy(memory.updatedAt)
        .limit(limit);
      return rows.map((r) => r.id);
    },
  };
}

export type IndexingStore = ReturnType<typeof indexingStore>;
