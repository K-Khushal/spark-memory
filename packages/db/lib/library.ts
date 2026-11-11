import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  ImageCapture,
  isFileWithinAllowance,
  MemoryEdit,
  TextCapture,
} from "@spark/core";
import type { Database } from "./client";
import { memory, memoryFile, memoryIndex, type FileRole } from "./schema";

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

/** The title Indexing gave a Memory, never shown for one with AI opt-out. */
const indexTitle = sql<string | null>`(
  select i.title from ${memoryIndex} i
  where i.memory_id = ${memory.id} and not ${memory.aiOptOut})`;

const columns = {
  id: memory.id,
  kind: memory.kind,
  title: memory.title,
  body: memory.body,
  captureNote: memory.captureNote,
  preservation: memory.preservation,
  indexState: memory.indexState,
  revision: memory.revision,
  /** For queue messages only; routes leave these out of answers. */
  indexRun: memory.indexRun,
  indexPriority: memory.indexPriority,
  aiOptOut: memory.aiOptOut,
  indexError: memory.indexError,
  indexTitle,
  capturedAt: memory.capturedAt,
  updatedAt: memory.updatedAt,
  image,
};

/** A Memory as the API reads it; routes turn `image` keys into signed URLs. */
export type Memory = Pick<
  typeof memory.$inferSelect,
  Exclude<keyof typeof columns, "image" | "indexTitle">
> & { image: MemoryImage | null; indexTitle: string | null };

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

/** What storage says of a file: there as described, absent, or not as described. */
export type FileCheck = "stored" | "missing" | "mismatch";

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

/**
 * One owner's uploads change one at a time: storage checks, retries,
 * confirmations and the sweep all take this lock, until the transaction ends.
 */
const lockOwner = (tx: Pick<Database, "execute">, userId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${STORAGE_LOCK}))`
  );

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

const today = sql`(now() at time zone 'utc')::date`;

/**
 * Indexing starts over as a new run, so whatever ran before cannot write.
 * For a person's Retry or opt-in: first in line once a Memory a day, then
 * in the background, which the daily budget limits.
 */
const restartIndexing = {
  indexState: "indexing",
  indexError: null,
  indexRun: sql`${memory.indexRun} + 1`,
  indexPriority: sql`case when ${memory.indexFreshDay} = ${today} then 'background' else 'fresh' end`,
  indexFreshDay: today,
} as const;

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

  /** Storage in use, counting uploads still in their window; optionally not one Memory's. */
  async function usedStorage(
    tx: Pick<Database, "select">,
    except?: string
  ): Promise<number> {
    const [row] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${memoryFile.bytes}), 0)` })
      .from(memoryFile)
      .innerJoin(memory, eq(memory.id, memoryFile.memoryId))
      .where(
        and(
          eq(memory.userId, userId),
          except === undefined ? undefined : ne(memory.id, except),
          sql`(${memoryFile.storedAt} is not null or ${memoryFile.createdAt} > now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS}))`
        )
      );
    return Number(row?.bytes ?? 0);
  }

  return {
    get,

    /** The owner's Memories among `ids` (the dashboard polls those Indexing). */
    getMany: (ids: string[]): Promise<Memory[]> =>
      ids.length
        ? db
            .select(columns)
            .from(memory)
            .where(and(eq(memory.userId, userId), inArray(memory.id, ids)))
        : Promise.resolve([]),

    /**
     * Saves pasted text, Indexing; its own words are keyword-searchable at
     * once (the trigger writes search_tsv with the row). The caller enqueues
     * Indexing. A retry with the same `id` returns the Memory already saved.
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
          indexPriority: "fresh",
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
        await lockOwner(tx, userId);
        const [taken] = await tx
          .select({ userId: memory.userId })
          .from(memory)
          .where(eq(memory.id, id));
        if (taken && taken.userId !== userId) return { conflict: true };
        if (taken) {
          // An expired upload no longer holds its storage: it must fit again.
          const [own] = await tx
            .select({
              bytes: sql<string>`coalesce(sum(${memoryFile.bytes}), 0)`,
              expired: sql<boolean>`coalesce(bool_or(${expiredUpload}), false)`,
            })
            .from(memoryFile)
            .where(eq(memoryFile.memoryId, id));
          if (
            own?.expired &&
            (await usedStorage(tx, id)) + Number(own.bytes) >
              FREE_ALLOWANCE.storageBytes
          ) {
            return { refused: "storage_full" };
          }
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
          indexPriority: "fresh",
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
            palette: capture.palette ?? null,
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
     * Marks a Memory's files stored once `check` (the storage side) confirms
     * each file not yet stored, so it shows on the wall. All under the
     * owner's lock, so the sweep can never take the objects in between.
     * "expired" when an upload outlived its window (retry it: that starts a
     * new one); "missing" or "mismatch" from `check`.
     */
    async markStored(
      id: string,
      check: (file: FileUpload) => Promise<FileCheck> = async () => "stored"
    ): Promise<Memory | "expired" | Exclude<FileCheck, "stored"> | undefined> {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [row] = await tx.select(columns).from(memory).where(owned(id));
        if (!row) return undefined;
        const late = await tx
          .select({ role: memoryFile.role })
          .from(memoryFile)
          .where(and(eq(memoryFile.memoryId, id), expiredUpload));
        if (late.length) return "expired";
        const pending = await tx
          .select(fileColumns)
          .from(memoryFile)
          .where(
            and(
              eq(memoryFile.memoryId, id),
              sql`${memoryFile.storedAt} is null`
            )
          );
        const checks = await Promise.all(
          pending.map(({ stored: _, ...f }) => check(f))
        );
        if (checks.includes("mismatch")) return "mismatch";
        if (checks.includes("missing")) return "missing";
        await tx
          .update(memoryFile)
          .set({ storedAt: sql`coalesce(${memoryFile.storedAt}, now())` })
          .where(eq(memoryFile.memoryId, id));
        const [now] = await tx.select(columns).from(memory).where(owned(id));
        return now;
      });
    },

    /** Bytes of storage in use, counting uploads still in their window. */
    usedStorage: () => usedStorage(db),

    /**
     * Image Memories whose upload has not finished (a page closed midway),
     * newest first, so the wall can offer to delete them before the sweep.
     */
    unfinished: (limit = 100): Promise<Memory[]> =>
      db
        .select(columns)
        .from(memory)
        .where(and(eq(memory.userId, userId), sql`not ${allStored}`))
        .orderBy(desc(memory.capturedAt), desc(memory.id))
        .limit(limit),

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
     * Edits text fields; the keyword index follows with the row. A changed
     * text restarts Indexing (unless AI opt-out); the caller enqueues it.
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
      const reindex =
        changes.body === undefined
          ? sql`false`
          : sql`${memory.body} is distinct from ${changes.body} and not ${memory.aiOptOut}`;
      const [row] = await db
        .update(memory)
        .set({
          ...changes,
          revision: sql`${memory.revision} + 1`,
          indexState: sql`case when ${reindex} then 'indexing' else ${memory.indexState} end`,
          indexRun: sql`${memory.indexRun} + (${reindex})::int`,
          indexError: sql`case when ${reindex} then null else ${memory.indexError} end`,
          // A fix to a Capture still on its first, fresh run stays first in
          // line; any later edit is background work.
          indexPriority: sql`case when ${reindex} and not (${memory.indexState} = 'indexing' and ${memory.indexPriority} = 'fresh') then 'background' else ${memory.indexPriority} end`,
        })
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

    /**
     * Retry on a Failed Memory: Indexing again, as a new run; the caller
     * enqueues it. Any other Memory comes back as it is.
     */
    async retryIndexing(id: string): Promise<Memory | undefined> {
      await db
        .update(memory)
        .set(restartIndexing)
        .where(and(owned(id), eq(memory.indexState, "failed")));
      return get(id);
    },

    /**
     * AI opt-out on: what Indexing found is deleted and the Memory is
     * Searchable by its own text at once; any Indexing under way is dropped
     * (a new run). Off: Indexing again, as a new run; the caller enqueues it.
     */
    async setAiOptOut(id: string, on: boolean): Promise<Memory | undefined> {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(memory)
          .set(
            on
              ? {
                  aiOptOut: true,
                  indexState: "searchable",
                  indexError: null,
                  indexRun: sql`${memory.indexRun} + 1`,
                  language: null,
                }
              : { aiOptOut: false, ...restartIndexing }
          )
          .where(and(owned(id), eq(memory.aiOptOut, !on)))
          .returning({ id: memory.id });
        if (row && on) {
          await tx.delete(memoryIndex).where(eq(memoryIndex.memoryId, id));
        }
      });
      return get(id);
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
 * Removes image Memories whose upload never finished within the upload
 * window (by the database's clock), a batch of owners at a time: their
 * objects first (an upload may have landed without being checked), then the
 * rows. Each owner's Memories go under that owner's lock, so a Try Again or
 * a confirmation waits and then finds the Memory gone, never stored without
 * its objects. If removing objects fails, the rows stay for the next sweep.
 * Returns how many Memories went.
 */
export async function sweepAbandonedUploads(
  db: Database,
  {
    removeObjects,
    owners = 50,
  }: {
    removeObjects: (keys: string[]) => Promise<void>;
    owners?: number;
  }
): Promise<number> {
  const due = await db
    .selectDistinct({ userId: memory.userId })
    .from(memoryFile)
    .innerJoin(memory, eq(memory.id, memoryFile.memoryId))
    .where(expiredUpload)
    .limit(owners);
  let total = 0;
  for (const { userId } of due) {
    total += await db.transaction(async (tx) => {
      await lockOwner(tx, userId);
      // Read again under the lock: a retry may have started a new window.
      const abandoned = tx
        .selectDistinct({ id: memoryFile.memoryId })
        .from(memoryFile)
        .innerJoin(memory, eq(memory.id, memoryFile.memoryId))
        .where(and(eq(memory.userId, userId), expiredUpload));
      const files = await tx
        .select({ memoryId: memoryFile.memoryId, key: memoryFile.key })
        .from(memoryFile)
        .where(inArray(memoryFile.memoryId, abandoned));
      if (!files.length) return 0;
      // R2 deletes at most 1,000 keys a call.
      const keys = files.map((f) => f.key);
      for (let i = 0; i < keys.length; i += 1000) {
        await removeObjects(keys.slice(i, i + 1000));
      }
      const ids = [...new Set(files.map((f) => f.memoryId))];
      const removed = await tx
        .delete(memory)
        .where(inArray(memory.id, ids))
        .returning({ id: memory.id });
      return removed.length;
    });
  }
  return total;
}
