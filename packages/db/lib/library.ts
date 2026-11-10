import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { MemoryEdit, TextCapture } from "@spark/core";
import type { Database } from "./client";
import { memory } from "./schema";

const columns = {
  id: memory.id,
  kind: memory.kind,
  title: memory.title,
  body: memory.body,
  captureNote: memory.captureNote,
  preservation: memory.preservation,
  indexState: memory.indexState,
  revision: memory.revision,
  capturedAt: memory.capturedAt,
  updatedAt: memory.updatedAt,
};

/** A Memory as clients see it. */
export type Memory = Pick<typeof memory.$inferSelect, keyof typeof columns>;

/** Which search legs found a Memory (ADR-0004). */
export type MatchedBy = "keyword" | "typo";
export type SearchResult = Memory & { matched: MatchedBy[] };

export type EditResult = Memory | { stale: true } | undefined;

export type CaptureResult =
  { created: boolean; memory: Memory } | { conflict: true };

export type Page = { memories: Memory[]; next?: string };

// A cursor is one shape only, which this module writes: the last Memory's
// Capture time as UTC microseconds since 1970 (exact, unlike a JS Date) and
// its id. Anything else is refused before it reaches Postgres.
const capturedAtMicros = sql<string>`(extract(epoch from ${memory.capturedAt}) * 1000000)::bigint::text`;
const fromMicros = (micros: number) =>
  sql`(to_timestamp(0) + ${micros}::bigint * interval '1 microsecond')`;

const MICROS = /^\d{1,16}$/;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function parseCursor(cursor: string) {
  const [at, id, extra] = cursor.split("~");
  if (!at || !id || extra !== undefined) return undefined;
  if (!MICROS.test(at) || !UUID.test(id)) return undefined;
  const micros = Number(at);
  return Number.isSafeInteger(micros) ? { micros, id } : undefined;
}

/**
 * One user's Library (GLOSSARY.md). The only way to reach the memory table:
 * every query is scoped to `userId` here, so no route can forget to.
 * Inputs are validated against the Free allowance (@spark/core).
 */
export function openLibrary(db: Database, userId: string) {
  const owned = (id: string) =>
    and(eq(memory.userId, userId), eq(memory.id, id));

  async function get(id: string): Promise<Memory | undefined> {
    const [row] = await db.select(columns).from(memory).where(owned(id));
    return row;
  }

  return {
    get,

    /**
     * Saves pasted text. Text needs no further Indexing for now: its keyword
     * index is written with the row, so it is Searchable at once. A retry with
     * the same `id` returns the Memory already saved.
     */
    async capture(input: TextCapture): Promise<CaptureResult> {
      const { id, body, title, captureNote } = TextCapture.parse(input);
      const [row] = await db
        .insert(memory)
        .values({
          id,
          userId,
          kind: "text",
          body,
          title,
          captureNote,
          indexState: "searchable",
        })
        .onConflictDoNothing({ target: memory.id })
        .returning(columns);
      if (row) return { created: true, memory: row };
      const existing = id ? await get(id) : undefined;
      return existing
        ? { created: false, memory: existing }
        : { conflict: true };
    },

    /**
     * Newest first, `limit` at a time; pass `next` back as `after`.
     * Undefined for a cursor this did not make.
     */
    async list({
      limit = 200,
      after,
    }: { limit?: number; after?: string } = {}): Promise<Page | undefined> {
      const cursor = after ? parseCursor(after) : undefined;
      if (after && !cursor) return undefined;
      const rows = await db
        .select({ ...columns, cursorAt: capturedAtMicros })
        .from(memory)
        .where(
          and(
            eq(memory.userId, userId),
            cursor &&
              or(
                sql`${memory.capturedAt} < ${fromMicros(cursor.micros)}`,
                and(
                  sql`${memory.capturedAt} = ${fromMicros(cursor.micros)}`,
                  lt(memory.id, cursor.id)
                )
              )
          )
        )
        .orderBy(desc(memory.capturedAt), desc(memory.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const memories = page.map(({ cursorAt: _, ...m }) => m);
      const last = page.at(-1);
      return rows.length > limit && last
        ? { memories, next: `${last.cursorAt}~${last.id}` }
        : { memories };
    },

    /**
     * Edits text fields; the generated keyword index re-indexes with the row.
     * With `revision`, the edit applies only if the Memory is still at that
     * revision, so a save that arrives late can never undo a newer one.
     */
    async edit(
      id: string,
      input: MemoryEdit,
      revision?: number
    ): Promise<EditResult> {
      const changes = MemoryEdit.parse(input);
      if (Object.keys(changes).length === 0) return get(id);
      const [row] = await db
        .update(memory)
        .set({ ...changes, revision: sql`${memory.revision} + 1` })
        .where(
          and(
            owned(id),
            revision === undefined ? undefined : eq(memory.revision, revision)
          )
        )
        .returning(columns);
      if (row) return row;
      return revision !== undefined && (await get(id))
        ? { stale: true }
        : undefined;
    },

    /** Deletes permanently. False when there was no such Memory. */
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(memory)
        .where(owned(id))
        .returning({ id: memory.id });
      return rows.length > 0;
    },

    /** Instant search: keyword and typo matching, no AI (PLAN.md §6.2). */
    async search(query: string, limit = 40): Promise<SearchResult[]> {
      if (!query.trim()) return [];
      const hits = db.$with("hits").as(
        db
          .select({
            id: sql<string>`id`.as("hit_id"),
            score: sql<number>`score`.as("score"),
            matched: sql<MatchedBy[]>`matched`.as("matched"),
          })
          .from(sql`search_memories(${userId}, ${query}, ${limit})`)
      );
      return db
        .with(hits)
        .select({ ...columns, matched: hits.matched })
        .from(hits)
        .innerJoin(memory, eq(memory.id, hits.id))
        .where(eq(memory.userId, userId))
        .orderBy(desc(hits.score));
    },
  };
}

export type Library = ReturnType<typeof openLibrary>;
