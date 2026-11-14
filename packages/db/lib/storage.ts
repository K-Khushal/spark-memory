import { sql } from "drizzle-orm";
import { FREE_ALLOWANCE } from "@spark/core";
import type { Database } from "./client";

/** An upload not stored by then no longer holds its storage. */
export const UPLOAD_WINDOW_HOURS = 24;

type Tx = Pick<Database, "execute">;

/** The text Indexing found for a Memory, as the database holds it. */
export type IndexText = {
  title: string;
  description: string;
  ocrText: string;
  entities: string[];
  tags: string[];
};

/** UTF-8 bytes: what a string takes in Postgres (octet_length). */
export const bytesOf = (value: string | null | undefined): number =>
  value ? new TextEncoder().encode(value).length : 0;

const indexBytes = (found: IndexText) =>
  bytesOf(found.title) +
  bytesOf(found.description) +
  bytesOf(found.ocrText) +
  bytesOf(found.entities.join(" ")) +
  bytesOf(found.tags.join(" "));

/**
 * Storage in use: files and reel copies (uploads still in their window
 * too), and every Memory's text: body, title, note, its metadata (a page's
 * description, a video's transcript) and what Indexing found. Samples take none. Optionally not one Memory's (`except`: all of
 * it) or not its text alone (`exceptText`, to replace it). Call it under
 * the owner's lock (`lockOwner`) when a decision rests on the answer.
 */
export async function usedStorageBytes(
  tx: Tx,
  userId: string,
  { except, exceptText }: { except?: string; exceptText?: string } = {}
): Promise<number> {
  const skip = (alias: string) =>
    sql`(${except ?? null}::uuid is null or ${sql.raw(alias)}.id <> ${except ?? null}::uuid)`;
  const skipText = sql`(${exceptText ?? null}::uuid is null or m.id <> ${exceptText ?? null}::uuid)`;
  const { rows } = await tx.execute<{ bytes: string }>(sql`select (
      (select coalesce(sum(f.bytes), 0) from memory_file f join memory m on m.id = f.memory_id
        where m.user_id = ${userId} and ${skip("m")}
          and (f.stored_at is not null or f.created_at > now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS})))
    + (select coalesce(sum(c.bytes), 0) from memory_copy c join memory m on m.id = c.memory_id
        where m.user_id = ${userId} and ${skip("m")}
          and (c.stored_at is not null or c.created_at > now() - make_interval(hours => ${UPLOAD_WINDOW_HOURS})))
    + (select coalesce(sum(octet_length(coalesce(m.body, '')) + octet_length(coalesce(m.title, ''))
          + octet_length(coalesce(m.capture_note, '')) + octet_length(coalesce(m.metadata::text, ''))), 0) from memory m
        where m.user_id = ${userId} and not m.sample and ${skip("m")} and ${skipText})
    + (select coalesce(sum(octet_length(i.title) + octet_length(i.description) + octet_length(i.ocr_text)
          + octet_length(array_to_string(i.entities, ' ')) + octet_length(array_to_string(i.tags, ' '))), 0)
        from memory_index i join memory m on m.id = i.memory_id
        where m.user_id = ${userId} and not m.sample and ${skip("m")} and ${skipText})
    )::text as bytes`);
  return Number(rows[0]?.bytes ?? 0);
}

/** The bytes of a Memory's metadata as the database keeps it (jsonb as text). */
export const metadataBytes = (metadata: unknown): number =>
  metadata === null || metadata === undefined
    ? 0
    : bytesOf(JSON.stringify(metadata));

/**
 * A video's metadata with its transcript left out, as the database keeps a
 * video whose transcript there was no room for (`over_allowance`). Anything
 * else in the metadata is returned as it is.
 */
export function withoutTranscript<M extends { video?: object }>(
  metadata: M
): M {
  if (!metadata.video) return metadata;
  return {
    ...metadata,
    video: {
      ...metadata.video,
      transcript: [],
      transcriptState: "over_allowance",
    },
  };
}

/** What `memoryId`'s text takes now, by part. */
async function currentText(tx: Tx, memoryId: string) {
  const { rows } = await tx.execute<{
    body: string;
    title: string;
    note: string;
    found: string;
    metabytes: string;
    metadata: unknown;
  }>(sql`select
      octet_length(coalesce(m.body, ''))::text as body,
      octet_length(coalesce(m.title, ''))::text as title,
      octet_length(coalesce(m.capture_note, ''))::text as note,
      octet_length(coalesce(m.metadata::text, ''))::text as metabytes,
      m.metadata as metadata,
      coalesce((select octet_length(i.title) + octet_length(i.description) + octet_length(i.ocr_text)
        + octet_length(array_to_string(i.entities, ' ')) + octet_length(array_to_string(i.tags, ' '))
        from memory_index i where i.memory_id = m.id), 0)::text as found
    from memory m where m.id = ${memoryId}`);
  const row = rows[0];
  return {
    body: Number(row?.body ?? 0),
    title: Number(row?.title ?? 0),
    note: Number(row?.note ?? 0),
    found: Number(row?.found ?? 0),
    metadata: row?.metadata ?? null,
    metabytes: Number(row?.metabytes ?? 0),
  };
}

/**
 * The one check every write of a Memory's text that is not the person's own
 * Capture goes through (Gather, a PDF's text, a transcript, a Deep fetch,
 * what Indexing found, an import's title and note): would `memoryId`'s text,
 * as it will be after the write (`after`, parts not named stay as stored;
 * `null` is none), fit the owner's storage? Call it under `lockOwner`, in
 * the transaction that makes the write, so parallel writers queue and
 * cannot all pass. A background path that gets `false` stores nothing of the
 * derived text, keeps the Memory and marks it `overAllowance` (the partly
 * Indexed state): it never fails a job for it.
 */
export async function textFits(
  tx: Tx,
  userId: string,
  memoryId: string,
  after: {
    body?: string | null;
    title?: string | null;
    captureNote?: string | null;
    /** What the metadata will be (or, given the current metadata, a function of it). */
    metadata?: unknown | ((current: unknown) => unknown);
    found?: IndexText | null;
  }
): Promise<boolean> {
  const [used, now] = await Promise.all([
    usedStorageBytes(tx, userId, { exceptText: memoryId }),
    currentText(tx, memoryId),
  ]);
  const total =
    (after.body === undefined ? now.body : bytesOf(after.body)) +
    (after.title === undefined ? now.title : bytesOf(after.title)) +
    (after.captureNote === undefined ? now.note : bytesOf(after.captureNote)) +
    (after.metadata === undefined
      ? now.metabytes
      : metadataBytes(
          typeof after.metadata === "function"
            ? (after.metadata as (current: unknown) => unknown)(now.metadata)
            : after.metadata
        )) +
    (after.found === undefined
      ? now.found
      : after.found === null
        ? 0
        : indexBytes(after.found));
  return used + total <= FREE_ALLOWANCE.storageBytes;
}

/** The same check for text of a Memory not yet written: `bytes` more fit. */
export async function roomFor(
  tx: Tx,
  userId: string,
  bytes: number
): Promise<boolean> {
  return (
    (await usedStorageBytes(tx, userId)) + bytes <= FREE_ALLOWANCE.storageBytes
  );
}
