import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  EMBEDDING,
  FREE_ALLOWANCE,
  ImageCapture,
  isFileWithinAllowance,
  LinkCapture,
  MemoryEdit,
  normaliseUrl,
  TextCapture,
  type MemoryKind,
} from "@spark/core";
import type { Database } from "./client";
import {
  deletionRequested,
  lockOwner,
  ownerPrefix,
  tryLockOwner,
} from "./owner";
import {
  memory,
  memoryFile,
  memoryIndex,
  memoryVector,
  objectRemoval,
  type FileRole,
  type PassageAnchor,
} from "./schema";
import * as schema from "./schema";

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

const baseColumns = {
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
  indexGeneration: memory.indexGeneration,
  indexPriority: memory.indexPriority,
  aiOptOut: memory.aiOptOut,
  indexError: memory.indexError,
  indexTitle,
  capturedAt: memory.capturedAt,
  lastSavedAt: memory.lastSavedAt,
  updatedAt: memory.updatedAt,
  /** A link's Source, and the page's own title and description once gathered. */
  sourceUrl: memory.sourceUrl,
  pageTitle: sql<string | null>`${memory.metadata}->>'title'`,
  description: sql<string | null>`${memory.metadata}->>'description'`,
  image,
};

/** A Memory as the API reads it; routes turn `image` keys into signed URLs. */
export type Memory = Pick<
  typeof memory.$inferSelect,
  Exclude<
    keyof typeof baseColumns,
    "image" | "indexTitle" | "pageTitle" | "description"
  >
> & {
  image: MemoryImage | null;
  indexTitle: string | null;
  pageTitle: string | null;
  description: string | null;
  /**
   * It has vectors in the space search uses now, so More Like This can
   * find something; false without an embedder (no paid tier).
   */
  hasVectors: boolean;
};

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

/**
 * A presigned PUT lives this long (apps/server/src/files.ts). An unfinished
 * Memory stays out of `unfinished` until then, so another tab cannot delete
 * it while a PUT may still land and leave an object with no row.
 */
export const UPLOAD_URL_MINUTES = 15;

/** A file whose upload did not finish within the window. */
const expiredUpload = sql`${memoryFile.storedAt} is null and ${memoryFile.createdAt} <= now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS})`;

/** An unstored file whose presigned PUT may still be used. */
const putStillValid = sql`exists (
  select 1 from memory_file f
  where f.memory_id = ${memory.id}
    and f.stored_at is null
    and f.created_at > now() - make_interval(mins => ${UPLOAD_URL_MINUTES}))`;

/**
 * One upload's object key: the owner's id, the Memory, that upload's
 * generation, the role. A later Try Again is a different key.
 */
const keyFor = (
  userId: string,
  memoryId: string,
  generation: string,
  role: FileRole
) => `${ownerPrefix(userId)}${memoryId}/${generation}/${role}`;

/** Every generation of one Memory. The sweep deletes this prefix, not one key. */
const memoryPrefix = (userId: string, memoryId: string) =>
  `${ownerPrefix(userId)}${memoryId}/`;

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
export type MatchedBy = "keyword" | "typo" | "vector";
/** What matched in the leg that ranked a Memory highest (migrations/0013). */
export type MatchedPart =
  | {
      kind: "field";
      field?:
        "title" | "note" | "tags" | "text" | "ocr" | "description" | "source";
    }
  | ({ kind: "passage" } & PassageAnchor)
  | { kind: "overview" | "visual" };
export type SearchResult = Memory & {
  matched: MatchedBy[];
  /** Cosine distance of its closest vector; null when the vector leg did not find it. */
  distance: number | null;
  part: MatchedPart;
};

/** The query's side of the vector leg: its vector, or a Memory's own (More Like This). */
export type VectorProbe = { model: string; dimensions: number } & (
  { vector: number[] } | { like: string }
);

export type SearchOptions = {
  limit?: number;
  probe?: VectorProbe;
  maxDistance?: number;
  kinds?: Memory["kind"][];
};

export type EditResult = Memory | { stale: true } | undefined;

export type CaptureResult =
  { created: boolean; memory: Memory } | { conflict: true };

/** `duplicate`: the page was already saved, so that Memory came back (moved to the top). */
export type LinkCaptureResult =
  { created: boolean; duplicate?: true; memory: Memory } | { conflict: true };

export type Page = { memories: Memory[]; next?: string };

/** A Memory as an export writes it: everything the person gave and Indexing found, and its original's key. */
export type ExportedMemory = {
  id: string;
  kind: MemoryKind;
  title: string | null;
  body: string | null;
  captureNote: string | null;
  aiOptOut: boolean;
  capturedAt: Date;
  updatedAt: Date;
  index: {
    title: string;
    description: string;
    ocrText: string;
    tags: string[];
    entities: string[];
  } | null;
  original: {
    key: string;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
  } | null;
};

// A cursor is one shape only, which this module writes: the last Memory's
// last-saved time as UTC microseconds since 1970 (exact, unlike a JS Date) and
// its id. Anything else is refused before it reaches Postgres.
const savedAtMicros = sql<string>`(extract(epoch from ${memory.lastSavedAt}) * 1000000)::bigint::text`;
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
 * `vectorsSpace` is the embedding space (`model@dimensions`) this
 * environment searches with; without one no Memory has usable vectors.
 */
export function openLibrary(
  db: Database,
  userId: string,
  { vectorsSpace }: { vectorsSpace?: string } = {}
) {
  const columns = {
    ...baseColumns,
    hasVectors: vectorsSpace
      ? sql<boolean>`coalesce(${memory.vectorsSpace} = ${vectorsSpace} and not ${memory.aiOptOut}, false)`
      : sql<boolean>`false`,
  };
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
      const parsed = TextCapture.parse(input);
      const { id, body, title, captureNote } = parsed;
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
          productAnalytics: parsed.productAnalytics === true,
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
     * Saves a pasted link, Indexing and Reference only until gathering keeps
     * its text; findable by its host at once. The caller enqueues Indexing.
     * A retry with the same `id` returns the same Memory. A page already in
     * the Library (same normalised URL) comes back as `duplicate`, moved to
     * the top, with this Capture note only if it had none.
     */
    async captureLink(input: LinkCapture): Promise<LinkCaptureResult> {
      const { id, url, captureNote, productAnalytics } =
        LinkCapture.parse(input);
      const normalised = normaliseUrl(url)!;
      const [row] = await db
        .insert(memory)
        .values({
          id,
          userId,
          kind: "link",
          sourceUrl: url,
          sourceUrlNormalised: normalised,
          captureNote,
          preservation: "reference_only",
          indexPriority: "fresh",
          productAnalytics: productAnalytics === true,
        })
        .onConflictDoNothing()
        .returning(columns);
      if (row) return { created: true, memory: row };
      if (id) {
        const [taken] = await db
          .select({ userId: memory.userId, url: memory.sourceUrlNormalised })
          .from(memory)
          .where(eq(memory.id, id));
        if (taken?.userId === userId && taken.url === normalised) {
          const retried = await get(id);
          if (retried) return { created: false, memory: retried };
        }
        if (taken) return { conflict: true };
      }
      const note = captureNote ?? null;
      const noteAdded = sql`(${memory.captureNote} is null and ${note}::text is not null)`;
      const [existing] = await db
        .update(memory)
        .set({
          lastSavedAt: sql`now()`,
          captureNote: sql`coalesce(${memory.captureNote}, ${note}::text)`,
          // A new note is new text for the vectors: the sweep embeds it again.
          revision: sql`${memory.revision} + (${noteAdded})::int`,
        })
        .where(
          and(
            eq(memory.userId, userId),
            eq(memory.sourceUrlNormalised, normalised)
          )
        )
        .returning(columns);
      return existing
        ? { created: false, duplicate: true, memory: existing }
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
        // An account being deleted takes no new uploads (account.ts).
        if (await deletionRequested(tx, userId)) return { conflict: true };
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
          // A retry is a new upload: a new generation and new keys, so a
          // confirm that already checked the previous objects cannot accept
          // this one. The previous keys stay until the presigned PUT can no
          // longer land, then the object sweep removes them. An abandoned
          // upload's sweep deletes them with the Memory, by those exact keys.
          const pending = await tx
            .select({ role: memoryFile.role, key: memoryFile.key })
            .from(memoryFile)
            .where(
              and(
                eq(memoryFile.memoryId, id),
                sql`${memoryFile.storedAt} is null`
              )
            );
          if (pending.length) {
            const generation = crypto.randomUUID();
            await tx
              .insert(objectRemoval)
              .values(
                pending.map((file) => ({
                  key: file.key,
                  dueAt: sql`now() + make_interval(mins => ${UPLOAD_URL_MINUTES})`,
                }))
              )
              .onConflictDoNothing();
            for (const file of pending) {
              await tx
                .update(memoryFile)
                .set({
                  createdAt: sql`now()`,
                  generation,
                  key: keyFor(userId, id, generation, file.role),
                })
                .where(
                  and(
                    eq(memoryFile.memoryId, id),
                    eq(memoryFile.role, file.role)
                  )
                );
            }
          }
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
          productAnalytics: capture.productAnalytics === true,
        });
        const generation = crypto.randomUUID();
        const uploads: FileUpload[] = [
          {
            role: "original",
            key: keyFor(userId, id, generation, "original"),
            mime: capture.mime,
            bytes: capture.bytes,
          },
          {
            role: "thumbnail",
            key: keyFor(userId, id, generation, "thumbnail"),
            mime: capture.thumbnail.mime,
            bytes: capture.thumbnail.bytes,
          },
        ];
        await tx.insert(memoryFile).values([
          {
            memoryId: id,
            generation,
            ...uploads[0]!,
            width: capture.width,
            height: capture.height,
            thumbhash: capture.thumbhash,
            palette: capture.palette ?? null,
          },
          { memoryId: id, generation, ...uploads[1]! },
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
     * each file not yet stored, so it shows on the wall. The check runs
     * before the owner's lock, bound to that file's generation, size and
     * type. Under the lock we reject the confirm if the upload was replaced
     * (Try Again mints a new generation), the row is gone, the upload has
     * expired, or the account is being deleted. "expired" when an upload
     * outlived its window (retry it: that starts a new one); "missing" or
     * "mismatch" from `check`, and "missing" when the generation, size or
     * type is no longer the one that was checked. Undefined when there is
     * no such Memory, or the account is being deleted.
     */
    async markStored(
      id: string,
      check: (file: FileUpload) => Promise<FileCheck> = async () => "stored"
    ): Promise<Memory | "expired" | Exclude<FileCheck, "stored"> | undefined> {
      const pending = await db
        .select({
          role: memoryFile.role,
          key: memoryFile.key,
          mime: memoryFile.mime,
          bytes: memoryFile.bytes,
          generation: memoryFile.generation,
        })
        .from(memoryFile)
        .innerJoin(memory, eq(memory.id, memoryFile.memoryId))
        .where(and(owned(id), sql`${memoryFile.storedAt} is null`));
      const checked = new Map(pending.map((file) => [file.role, file]));
      const checks = await Promise.all(pending.map((file) => check(file)));
      if (checks.includes("mismatch")) return "mismatch";
      if (checks.includes("missing")) return "missing";
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        // Account deletion takes this lock too (account.ts): never store
        // files for an account that is going away.
        if (await deletionRequested(tx, userId)) return undefined;
        const [row] = await tx.select(columns).from(memory).where(owned(id));
        if (!row) return undefined;
        const late = await tx
          .select({ role: memoryFile.role })
          .from(memoryFile)
          .where(and(eq(memoryFile.memoryId, id), expiredUpload));
        if (late.length) return "expired";
        // The files still waiting must be the generation, size and type the
        // check just saw. A sweep plus Try Again recreates the same id with
        // a new generation; accepting the old check would store a Memory
        // whose objects were never there.
        const still = await tx
          .select({
            role: memoryFile.role,
            key: memoryFile.key,
            mime: memoryFile.mime,
            bytes: memoryFile.bytes,
            generation: memoryFile.generation,
          })
          .from(memoryFile)
          .where(
            and(
              eq(memoryFile.memoryId, id),
              sql`${memoryFile.storedAt} is null`
            )
          );
        const same = still.every((file) => {
          const seen = checked.get(file.role);
          return (
            seen !== undefined &&
            seen.generation === file.generation &&
            seen.key === file.key &&
            seen.mime === file.mime &&
            seen.bytes === file.bytes
          );
        });
        if (!same) return "missing";
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
     * Image Memories whose upload has not finished and whose presigned PUT
     * has expired, newest first, so the wall can offer to delete them before
     * the sweep. Younger ones stay out: another tab may still be uploading.
     */
    unfinished: (limit = 100): Promise<Memory[]> =>
      db
        .select(columns)
        .from(memory)
        .where(
          and(
            eq(memory.userId, userId),
            sql`not ${allStored}`,
            sql`not (${putStillValid})`
          )
        )
        .orderBy(desc(memory.capturedAt), desc(memory.id))
        .limit(limit),

    /**
     * Last saved first (a duplicate Capture moves a Memory up), `limit` at a time; pass `next` back as `after`.
     * Undefined for a cursor this did not make.
     */
    async list({
      limit = 200,
      after,
    }: { limit?: number; after?: string } = {}): Promise<Page | undefined> {
      const cursor = after ? parseCursor(after) : undefined;
      if (after && !cursor) return undefined;
      const rows = await db
        .select({ ...columns, cursorAt: savedAtMicros })
        .from(memory)
        .where(
          and(
            eq(memory.userId, userId),
            allStored,
            cursor &&
              or(
                sql`${memory.lastSavedAt} < ${fromMicros(cursor.micros)}`,
                and(
                  sql`${memory.lastSavedAt} = ${fromMicros(cursor.micros)}`,
                  lt(memory.id, cursor.id)
                )
              )
          )
        )
        .orderBy(desc(memory.lastSavedAt), desc(memory.id))
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
      // One transaction: new text and the end of the old text's vectors
      // (they would match it, and point into the new text) land together.
      const row = await db.transaction(async (tx) => {
        const [edited] = await tx
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
            vectorsSpace: sql`case when ${reindex} then null else ${memory.vectorsSpace} end`,
            vectorsRevision: sql`case when ${reindex} then null else ${memory.vectorsRevision} end`,
          })
          .where(
            and(
              owned(id),
              // Only a text Memory has text to edit.
              changes.body === undefined ? undefined : eq(memory.kind, "text"),
              revision === undefined ? undefined : eq(memory.revision, revision)
            )
          )
          .returning({ ...columns, vectorsSpace: memory.vectorsSpace });
        if (!edited) return undefined;
        const { vectorsSpace, ...shown } = edited;
        // Vectors always come with their space: none means none are kept.
        if (vectorsSpace === null) {
          await tx.delete(memoryVector).where(eq(memoryVector.memoryId, id));
        }
        return shown;
      });
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
          await tx.delete(memoryVector).where(eq(memoryVector.memoryId, id));
          await tx
            .update(memory)
            .set({ vectorsSpace: null, vectorsRevision: null })
            .where(eq(memory.id, id));
        }
      });
      return get(id);
    },

    /**
     * Every Memory on the wall, for an export: `limit` at a time in id
     * order; pass the last id back as `after`.
     */
    exportPage: (after?: string, limit = 200): Promise<ExportedMemory[]> =>
      db
        .select({
          id: memory.id,
          kind: memory.kind,
          title: memory.title,
          body: memory.body,
          captureNote: memory.captureNote,
          aiOptOut: memory.aiOptOut,
          capturedAt: memory.capturedAt,
          updatedAt: memory.updatedAt,
          index: sql<
            ExportedMemory["index"]
          >`case when ${memoryIndex.memoryId} is null or ${memory.aiOptOut} then null else json_build_object(
            'title', ${memoryIndex.title}, 'description', ${memoryIndex.description},
            'ocrText', ${memoryIndex.ocrText}, 'tags', ${memoryIndex.tags},
            'entities', ${memoryIndex.entities}) end`,
          original: sql<
            ExportedMemory["original"]
          >`case when ${memoryFile.key} is null then null else json_build_object(
            'key', ${memoryFile.key}, 'mime', ${memoryFile.mime}, 'bytes', ${memoryFile.bytes},
            'width', ${memoryFile.width}, 'height', ${memoryFile.height}) end`,
        })
        .from(memory)
        .leftJoin(memoryIndex, eq(memoryIndex.memoryId, memory.id))
        .leftJoin(
          memoryFile,
          and(
            eq(memoryFile.memoryId, memory.id),
            eq(memoryFile.role, "original")
          )
        )
        .where(
          and(
            eq(memory.userId, userId),
            allStored,
            after && UUID.test(after) ? sql`${memory.id} > ${after}` : undefined
          )
        )
        .orderBy(asc(memory.id))
        .limit(limit),

    /**
     * Hybrid search (ADR-0004), best first: keyword and typo matching, and
     * with a `probe` the vector leg too. Without one it is instant search
     * (PLAN.md §6.2). A `like` probe is More Like This for one of the
     * owner's Memories, which is left out.
     */
    async search(
      query: string,
      {
        limit = 40,
        probe,
        maxDistance = EMBEDDING.maxDistance,
        kinds,
      }: SearchOptions = {}
    ): Promise<SearchResult[]> {
      if (!query.trim() && !probe) return [];
      const vector =
        probe && "vector" in probe ? `[${probe.vector.join(",")}]` : null;
      const like = probe && "like" in probe ? probe.like : null;
      if (like && !UUID.test(like)) return [];
      const hits = db.$with("hits").as(
        db
          .select({
            id: sql<string>`id`.as("hit_id"),
            score: sql<number>`score`.as("score"),
            matched: sql<MatchedBy[]>`matched`.as("matched"),
            distance: sql<number | null>`distance`.as("distance"),
            part: sql<MatchedPart>`part`.as("part"),
          })
          .from(
            sql`search_memories(${userId}, ${query}, ${limit}, ${vector}::halfvec, ${like}::uuid, ${probe?.model ?? null}, ${probe?.dimensions ?? null}::int, ${maxDistance}::float8, ${kinds ? `{${kinds.join(",")}}` : null}::text[])`
          )
      );
      return db
        .with(hits)
        .select({
          ...columns,
          matched: hits.matched,
          distance: hits.distance,
          part: hits.part,
        })
        .from(hits)
        .innerJoin(memory, eq(memory.id, hits.id))
        .where(and(eq(memory.userId, userId), allStored))
        .orderBy(desc(hits.score), asc(hits.id));
    },
  };
}

export type Library = ReturnType<typeof openLibrary>;

/**
 * How long one sweep may run before it stops and leaves the rest for the
 * next hourly run. The account sweep runs in the same cron and has the
 * same budget (account.ts).
 */
export const SWEEP_BUDGET_MS = 20_000;

/** R2 deletes at most this many keys in one call. A batch is one such call. */
const R2_DELETE_KEYS = 1_000;

/** Bounds SQL and lock waits in this transaction to the time the sweep has left. */
const localTimeouts = (tx: Pick<Database, "execute">, ms: number) => {
  const budget = `${Math.max(1, Math.floor(ms))}ms`;
  return tx.execute(sql`
    select set_config('statement_timeout', ${budget}, true),
           set_config('lock_timeout', ${budget}, true)
  `);
};

/**
 * The abandoned Memories whose keys fit in one bulk delete, oldest id first.
 * Keys are the current objects (including ones stored before generations)
 * and any replaced key already queued for that Memory. The set is fixed
 * here, under the lock: a later Try Again is a different key.
 */
async function abandonedBatch(
  tx: Pick<Database, "select" | "selectDistinct">,
  userId: string,
  keysPerDelete: number,
  step: () => Promise<void>
): Promise<{ ids: string[]; keys: string[] } | undefined> {
  await step();
  const rows = await tx
    .selectDistinct({ id: memory.id })
    .from(memory)
    .innerJoin(memoryFile, eq(memoryFile.memoryId, memory.id))
    .where(and(eq(memory.userId, userId), expiredUpload))
    .orderBy(asc(memory.id))
    .limit(keysPerDelete);
  if (!rows.length) return undefined;
  const candidateIds = rows.map((row) => row.id);
  await step();
  const files = await tx
    .select({ memoryId: memoryFile.memoryId, key: memoryFile.key })
    .from(memoryFile)
    .where(inArray(memoryFile.memoryId, candidateIds));
  await step();
  const replaced = await tx
    .select({ key: objectRemoval.key })
    .from(objectRemoval)
    .where(
      or(
        ...candidateIds.map(
          (id) =>
            sql`starts_with(${objectRemoval.key}, ${memoryPrefix(userId, id)})`
        )
      )
    );
  const ids: string[] = [];
  const keys: string[] = [];
  for (const id of candidateIds) {
    const prefix = memoryPrefix(userId, id);
    const own = [
      ...new Set([
        ...files.filter((file) => file.memoryId === id).map((file) => file.key),
        ...replaced
          .filter((row) => row.key.startsWith(prefix))
          .map((row) => row.key),
      ]),
    ];
    if (ids.length && keys.length + own.length > keysPerDelete) break;
    ids.push(id);
    keys.push(...own);
    if (keys.length >= keysPerDelete) break;
  }
  return ids.length ? { ids, keys } : undefined;
}

/** Stops waiting on `work` when `signal` aborts, so a slow delete cannot hold the lock. */
const untilAborted = (work: Promise<void>, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error("sweep: storage delete aborted"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
    work.then(
      () => {
        signal.removeEventListener("abort", fail);
        if (signal.aborted) fail();
        else resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", fail);
        reject(
          error instanceof Error
            ? error
            : new Error("sweep: storage delete failed")
        );
      }
    );
  });

/**
 * Removes image Memories whose upload never finished within the upload
 * window (by the database's clock). Each run takes up to `owners` of them
 * in random order, so a failing owner cannot stand in front of the others
 * hour after hour. A storage failure is skipped for the rest of this run.
 * Nothing starts once `deadline` (epoch ms) has passed, and every statement
 * uses only the time still left. Each batch is one bulk delete of at most
 * `keysPerDelete` exact keys captured under the owner's lock. The delete is
 * aborted when the time left runs out, the transaction rolls back, and the
 * rows stay. An owner whose lock another run holds is skipped. `allowCall`
 * returning false stops the pass before another storage call. Returns how
 * many Memories went. `orderSeed` fixes the order for tests (`setseed`).
 */
export async function sweepAbandonedUploads(
  db: Database,
  {
    removeObjects,
    owners = 50,
    keysPerDelete = R2_DELETE_KEYS,
    deadline = Date.now() + SWEEP_BUDGET_MS,
    orderSeed,
    allowCall,
  }: {
    removeObjects: (keys: string[], signal: AbortSignal) => Promise<void>;
    owners?: number;
    /** Keys in one bulk delete. One call, at most 1,000 (R2's limit). */
    keysPerDelete?: number;
    deadline?: number;
    /** Passed to `setseed` so a test can rely on the order. */
    orderSeed?: number;
    /** False once this invocation has spent its storage calls. */
    allowCall?: () => boolean;
  }
): Promise<number> {
  const skipped = new Set<string>();
  let total = 0;
  let stop = false;
  while (!stop && Date.now() < deadline) {
    let due: { userId: string }[];
    try {
      due = await db.transaction(async (tx) => {
        const left = deadline - Date.now();
        if (left <= 0) return [];
        await localTimeouts(tx, left);
        if (orderSeed !== undefined) {
          await tx.execute(
            sql`select setseed(cast(${orderSeed} as double precision))`
          );
        }
        const except =
          skipped.size === 0
            ? sql``
            : sql`and ${memory.userId} not in (${sql.join(
                [...skipped].map((id) => sql`${id}`),
                sql`, `
              )})`;
        const { rows } = await tx.execute<{ user_id: string }>(sql`
          select user_id from (
            select distinct ${memory.userId} as user_id
            from ${memoryFile}
            inner join ${memory} on ${memory.id} = ${memoryFile.memoryId}
            where ${expiredUpload}
            ${except}
          ) due_owner
          order by random()
          limit ${owners}
        `);
        return rows.map((row) => ({ userId: row.user_id }));
      });
    } catch {
      console.error("sweep: owner query stopped");
      break;
    }
    if (!due.length) break;
    for (const { userId } of due) {
      if (Date.now() >= deadline) {
        stop = true;
        break;
      }
      if (skipped.has(userId)) continue;
      try {
        for (;;) {
          if (Date.now() >= deadline) {
            stop = true;
            break;
          }
          const removed = await timedBatch(db, deadline, async (tx, step) => {
            // Do not wait: a confirm already in this lock would run the sweep
            // past the budget. The next run tries this owner again.
            await step();
            if (!(await tryLockOwner(tx, userId))) return null;
            const batch = await abandonedBatch(tx, userId, keysPerDelete, step);
            if (!batch) return 0;
            const nowLeft = deadline - Date.now();
            if (nowLeft <= 0) return 0;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), nowLeft);
            try {
              for (let i = 0; i < batch.keys.length; i += R2_DELETE_KEYS) {
                if (controller.signal.aborted || Date.now() >= deadline) {
                  throw new Error("sweep: storage delete aborted");
                }
                if (allowCall && !allowCall()) {
                  throw new Error("sweep: call budget spent");
                }
                await untilAborted(
                  removeObjects(
                    batch.keys.slice(i, i + R2_DELETE_KEYS),
                    controller.signal
                  ),
                  controller.signal
                );
              }
            } finally {
              clearTimeout(timer);
            }
            if (controller.signal.aborted) {
              throw new Error("sweep: storage delete aborted");
            }
            // Each statement gets only the time still left. One setting at
            // the start would give every later statement that whole budget.
            await step();
            if (batch.keys.length) {
              await tx
                .delete(objectRemoval)
                .where(inArray(objectRemoval.key, batch.keys));
            }
            await step();
            const gone = await tx
              .delete(memory)
              .where(inArray(memory.id, batch.ids))
              .returning({ id: memory.id });
            return gone.length;
          });
          if (removed === null) {
            skipped.add(userId);
            break;
          }
          total += removed;
          if (removed === 0 || Date.now() >= deadline) {
            stop = Date.now() >= deadline;
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("call budget spent")) {
          stop = true;
        } else {
          // Their rows stay. Skip them for this run so the others still go.
          skipped.add(userId);
          console.error("sweep: one owner failed");
          stop =
            message.includes("storage delete aborted") ||
            Date.now() >= deadline;
        }
      }
      if (stop) break;
    }
  }
  return total;
}

/**
 * One batch on a single connection. Time left is measured after checkout,
 * so a slow pool wait cannot start BEGIN, and the connection is always
 * released. The session timeout is set before BEGIN and again before each
 * statement, then reset before the connection returns to the pool.
 */
async function timedBatch<T>(
  db: Database,
  deadline: number,
  run: (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    step: () => Promise<void>
  ) => Promise<T>
): Promise<T> {
  const client = await db.$client.connect();
  try {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("sweep: storage delete aborted");
    await client.query(
      `select set_config('statement_timeout', $1, false),
              set_config('lock_timeout', $1, false)`,
      [`${Math.max(1, Math.floor(left))}ms`]
    );
    const scoped = drizzle({ client, schema });
    try {
      return await scoped.transaction(async (tx) => {
        const step = async () => {
          const nowLeft = deadline - Date.now();
          if (nowLeft <= 0) throw new Error("sweep: storage delete aborted");
          await localTimeouts(tx, nowLeft);
        };
        return run(tx, step);
      });
    } finally {
      await client.query("RESET statement_timeout").catch(() => {});
      await client.query("RESET lock_timeout").catch(() => {});
    }
  } finally {
    client.release();
  }
}
