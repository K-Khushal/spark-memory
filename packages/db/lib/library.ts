import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  ImageCapture,
  isFileWithinAllowance,
  MemoryEdit,
  TextCapture,
} from "@spark/core";
import type { Database } from "./client";
import { memory, memoryFile, type FileRole } from "./schema";

/** An image Memory's files: what the wall needs, and the keys to sign. */
export type MemoryImage = {
  mime: string;
  bytes: number;
  width: number;
  height: number;
  thumbhash: string;
  key: string;
  thumbnailKey: string;
  thumbnailMime: string;
};

const image = sql<MemoryImage | null>`(
  select json_build_object(
    'mime', o.mime, 'bytes', o.bytes, 'width', o.width, 'height', o.height,
    'thumbhash', o.thumbhash, 'key', o.r2_key,
    'thumbnailKey', t.r2_key, 'thumbnailMime', t.mime)
  from memory_file o join memory_file t
    on t.memory_id = o.memory_id and t.role = 'thumbnail'
  where o.memory_id = ${memory.id} and o.role = 'original')`;

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
  image,
};

/** A Memory as the API reads it; routes turn `image` keys into signed URLs. */
export type Memory = Pick<
  typeof memory.$inferSelect,
  Exclude<keyof typeof columns, "image">
> & { image: MemoryImage | null };

/** A Memory shows once every file it has is stored. */
const allStored = sql`not exists (select 1 from memory_file f where f.memory_id = ${memory.id} and f.stored_at is null)`;

/** A file the browser still has to upload, to `key`, with exactly this type and size. */
export type FileUpload = {
  role: FileRole;
  key: string;
  mime: string;
  bytes: number;
};

export type MemoryFileInfo = FileUpload & { stored: boolean };

export type ImageCaptureResult =
  | { created: boolean; memory: Memory; uploads: FileUpload[] }
  | { conflict: true }
  | { refused: "file_too_large" | "storage_full" };

/**
 * Uploads that have not finished count towards storage for this long (so
 * parallel Captures cannot overfill it), and are swept after it.
 */
export const UPLOAD_WINDOW_HOURS = 24;

/** A file whose upload did not finish within the window. */
const expiredUpload = sql`${memoryFile.storedAt} is null and ${memoryFile.createdAt} <= now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS})`;

/** Seeds the per-owner advisory lock around storage checks (its own lock space). */
const STORAGE_LOCK = 6;

/** Object keys are the server's: the owner's id, the Memory's id, the role. */
const keyFor = (userId: string, memoryId: string, role: FileRole) =>
  `users/${userId}/${memoryId}/${role}`;

const fileColumns = {
  role: memoryFile.role,
  key: memoryFile.key,
  mime: memoryFile.mime,
  bytes: memoryFile.bytes,
  stored: sql<boolean>`${memoryFile.storedAt} is not null`,
};

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

  async function usedStorage(tx: Pick<Database, "select">): Promise<number> {
    const [row] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${memoryFile.bytes}), 0)` })
      .from(memoryFile)
      .innerJoin(memory, eq(memory.id, memoryFile.memoryId))
      .where(
        and(
          eq(memory.userId, userId),
          sql`(${memoryFile.storedAt} is not null or ${memoryFile.createdAt} > now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS}))`
        )
      );
    return Number(row?.bytes ?? 0);
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
     * Creates an image Memory before its files are uploaded, within the Free
     * allowance, and says which files to upload where. A retry with the same
     * `id` returns the same Memory and only the uploads still missing.
     * Storage is checked under a per-owner lock, so parallel Captures queue.
     */
    async captureImage(input: ImageCapture): Promise<ImageCaptureResult> {
      const capture = ImageCapture.parse(input);
      const { id } = capture;
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${STORAGE_LOCK}))`
        );
        const [taken] = await tx
          .select({ userId: memory.userId })
          .from(memory)
          .where(eq(memory.id, id));
        if (taken && taken.userId !== userId) return { conflict: true };
        if (taken) {
          // A retry starts the upload window again for the files still
          // missing, so a late Try Again is neither swept nor refused.
          await tx
            .update(memoryFile)
            .set({ createdAt: sql`now()` })
            .where(
              and(
                eq(memoryFile.memoryId, id),
                sql`${memoryFile.storedAt} is null`
              )
            );
          const files = await tx
            .select(fileColumns)
            .from(memoryFile)
            .where(eq(memoryFile.memoryId, id))
            .orderBy(asc(memoryFile.role));
          const [row] = await tx.select(columns).from(memory).where(owned(id));
          if (!row?.image) return { conflict: true };
          const uploads = files
            .filter((f) => !f.stored)
            .map(({ stored: _, ...f }) => f);
          return { created: false, memory: row, uploads };
        }

        // The thumbnail takes storage too, but only the original is the upload.
        const allowed = isFileWithinAllowance({
          fileBytes: capture.bytes,
          usedStorageBytes: (await usedStorage(tx)) + capture.thumbnail.bytes,
        });
        if (!allowed.ok) return { refused: allowed.reason };

        await tx.insert(memory).values({
          id,
          userId,
          kind: "image",
          contentHash: capture.contentHash,
          indexState: "indexing",
        });
        const uploads: FileUpload[] = [
          {
            role: "original",
            key: keyFor(userId, id, "original"),
            mime: capture.mime,
            bytes: capture.bytes,
          },
          {
            role: "thumbnail",
            key: keyFor(userId, id, "thumbnail"),
            mime: capture.thumbnail.mime,
            bytes: capture.thumbnail.bytes,
          },
        ];
        await tx.insert(memoryFile).values([
          {
            memoryId: id,
            ...uploads[0]!,
            width: capture.width,
            height: capture.height,
            thumbhash: capture.thumbhash,
          },
          { memoryId: id, ...uploads[1]! },
        ]);
        const [row] = await tx.select(columns).from(memory).where(owned(id));
        return { created: true, memory: row!, uploads };
      });
    },

    /** A Memory's files, to check or delete them. Undefined for no such Memory. */
    async files(id: string): Promise<MemoryFileInfo[] | undefined> {
      if (!(await get(id))) return undefined;
      return db
        .select(fileColumns)
        .from(memoryFile)
        .where(eq(memoryFile.memoryId, id))
        .orderBy(asc(memoryFile.role));
    },

    /**
     * Marks a Memory's files stored (after checking them), so it shows on the
     * wall. "expired" when an upload outlived its window: the sweep may be
     * taking its objects, so it must be retried (which starts a new window).
     */
    async markStored(id: string): Promise<Memory | "expired" | undefined> {
      if (!(await get(id))) return undefined;
      const late = await db
        .select({ role: memoryFile.role })
        .from(memoryFile)
        .where(and(eq(memoryFile.memoryId, id), expiredUpload));
      if (late.length) return "expired";
      await db
        .update(memoryFile)
        .set({ storedAt: sql`coalesce(${memoryFile.storedAt}, now())` })
        .where(eq(memoryFile.memoryId, id));
      return get(id);
    },

    /** Bytes of storage in use, counting uploads still in their window. */
    usedStorage: () => usedStorage(db),

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
            allStored,
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
            // Only a text Memory has text to edit.
            changes.body === undefined ? undefined : eq(memory.kind, "text"),
            revision === undefined ? undefined : eq(memory.revision, revision)
          )
        )
        .returning(columns);
      if (row) return row;
      const now = revision === undefined ? undefined : await get(id);
      return now && (changes.body === undefined || now.kind === "text")
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
        .where(and(eq(memory.userId, userId), allStored))
        .orderBy(desc(hits.score));
    },
  };
}

export type Library = ReturnType<typeof openLibrary>;

/**
 * Removes image Memories whose upload never finished (the page closed or the
 * person gave up) once they are older than `before`, for every user: their
 * objects first (an upload may have landed without being checked), then the
 * rows. If removing objects fails, the rows stay for the next sweep.
 * Returns how many Memories went.
 */
export async function sweepAbandonedUploads(
  db: Database,
  {
    before,
    removeObjects,
    limit = 500,
  }: {
    before: Date;
    removeObjects: (keys: string[]) => Promise<void>;
    limit?: number;
  }
): Promise<number> {
  const abandoned = db
    .selectDistinct({ id: memoryFile.memoryId })
    .from(memoryFile)
    .where(
      and(sql`${memoryFile.storedAt} is null`, lt(memoryFile.createdAt, before))
    )
    .limit(limit);
  const files = await db
    .select({ memoryId: memoryFile.memoryId, key: memoryFile.key })
    .from(memoryFile)
    .where(inArray(memoryFile.memoryId, abandoned));
  if (!files.length) return 0;
  await removeObjects(files.map((f) => f.key));
  const ids = [...new Set(files.map((f) => f.memoryId))];
  const removed = await db
    .delete(memory)
    // Only rows still abandoned: a Try Again meanwhile restarted the window
    // (its upload re-sends the files), and a stored one stays.
    .where(
      and(
        inArray(memory.id, ids),
        sql`exists (select 1 from memory_file f where f.memory_id = ${memory.id} and f.stored_at is null and f.created_at < ${before})`
      )
    )
    .returning({ id: memory.id });
  return removed.length;
}
