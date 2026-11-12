import {
  accountJobs,
  DELETION_GRACE_MINUTES,
  openDatabase,
  openLibrary,
  type Database,
  type ExportedMemory,
  type Library,
} from "@spark/db";
import { forgetQueryVectors } from "@spark/search";
import type { CronCalls } from "./cron-budget";
import type { AccountMessage, Bindings, FileBucket } from "./env";
import { fixedParts, zipStream, type ZipEntry } from "./zip";

/**
 * The account queue's consumer: Library exports and account deletion, both
 * idempotent (see `accountJobs` in @spark/db), so a duplicate or retried
 * message is harmless. Logs carry outcomes only, never ids or content.
 */

/** R2 multipart parts are all this size but the last (they must be equal). */
const PART_BYTES = 8 * 1024 * 1024;
const RETRY_SECONDS = 60;
/** The next deletion pass, once the grace period has surely passed. */
const DELETION_RECHECK_SECONDS = (DELETION_GRACE_MINUTES + 1) * 60;

export type AccountBatch = {
  messages: readonly {
    body: AccountMessage;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }[];
};

export async function consumeAccount(batch: AccountBatch, env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    for (const message of batch.messages) {
      const { body } = message;
      try {
        if (body.kind === "export") {
          const outcome = await buildExport(db, env.FILES, body.exportId);
          console.log(`account: export ${outcome}`);
        } else {
          forgetQueryVectors(body.userId);
          const outcome = await continueDeletion(db, env.FILES, body.userId);
          if (outcome === "waiting") {
            await env.ACCOUNT_QUEUE.send(body, {
              delaySeconds: DELETION_RECHECK_SECONDS,
            }).catch(() => console.error("account: deletion not re-sent"));
          }
          console.log(`account: deletion ${outcome}`);
        }
        message.ack();
      } catch {
        // Storage or the database: the same message, later. An export out
        // of attempts is Failed instead (the person can ask again).
        if (body.kind === "export") {
          const next = await accountJobs(db).failExport(body.exportId);
          console.error(`account: export failed (${next})`);
          if (next === "failed") {
            message.ack();
            continue;
          }
        } else {
          console.error("account: deletion step failed");
        }
        message.retry({ delaySeconds: RETRY_SECONDS });
      }
    }
  } finally {
    await close();
  }
}

/** Removes every object under `prefix`, a listing page (up to 1,000) at a time. */
export async function removePrefix(bucket: FileBucket, prefix: string) {
  for (;;) {
    const { objects } = await bucket.list({ prefix, limit: 1000 });
    if (!objects.length) return;
    await bucket.delete(objects.map((o) => o.key));
  }
}

export const continueDeletion = (
  db: Database,
  bucket: FileBucket,
  userId: string
) =>
  accountJobs(db).continueDeletion(userId, (prefix) =>
    removePrefix(bucket, prefix)
  );

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** A Memory in memories.json: what the person gave, what Indexing found, and its file in the ZIP. */
function exported(memory: ExportedMemory) {
  const { original, index, ...rest } = memory;
  return {
    ...rest,
    indexed: index,
    file: original && {
      path: fileName(memory),
      mime: original.mime,
      bytes: original.bytes,
      width: original.width,
      height: original.height,
    },
  };
}

const fileName = (memory: ExportedMemory) =>
  `files/${memory.id}.${EXTENSIONS[memory.original?.mime ?? ""] ?? "bin"}`;

/**
 * memories.json, written a page of Memories at a time, then every original
 * it lists, streamed from storage. One pass over the database: the files
 * are exactly the ones memories.json names.
 */
async function* exportEntries(
  library: Library,
  bucket: FileBucket,
  at: Date
): AsyncGenerator<ZipEntry> {
  const files: { name: string; key: string; modified: Date }[] = [];
  const encode = (text: string) => new TextEncoder().encode(text);
  yield {
    name: "memories.json",
    modified: at,
    body: async () =>
      (async function* () {
        yield encode("[");
        let after: string | undefined;
        let first = true;
        for (;;) {
          const page = await library.exportPage(after);
          for (const memory of page) {
            if (memory.original) {
              files.push({
                name: fileName(memory),
                key: memory.original.key,
                modified: memory.capturedAt,
              });
            }
            yield encode(
              `${first ? "" : ","}\n${JSON.stringify(exported(memory))}`
            );
            first = false;
          }
          if (!page.length) break;
          after = page.at(-1)!.id;
        }
        yield encode("\n]\n");
      })(),
  };
  yield {
    name: "searches.json",
    modified: at,
    body: async () =>
      (async function* () {
        yield encode(JSON.stringify(await library.searchData()));
      })(),
  };
  for (const file of files) {
    yield {
      name: file.name,
      modified: file.modified,
      body: async () => {
        // A Memory deleted since memories.json was written: left out.
        const object = await bucket.get(file.key);
        return object?.body as AsyncIterable<Uint8Array> | undefined;
      },
    };
  }
}

/** Builds one export into storage as a ZIP. "skipped" when it is not this message's to build. */
export async function buildExport(
  db: Database,
  bucket: FileBucket,
  exportId: string
): Promise<"ready" | "skipped"> {
  const jobs = accountJobs(db);
  const claim = await jobs.claimExport(exportId);
  if (!claim) return "skipped";
  const now = new Date();
  const upload = await bucket.createMultipartUpload(claim.key, {
    httpMetadata: {
      contentType: "application/zip",
      contentDisposition: `attachment; filename="spark-library-${now.toISOString().slice(0, 10)}.zip"`,
    },
  });
  try {
    const library = openLibrary(db, claim.userId);
    const parts = [];
    let bytes = 0;
    const zip = zipStream(exportEntries(library, bucket, now));
    for await (const part of fixedParts(zip, PART_BYTES)) {
      parts.push(await upload.uploadPart(parts.length + 1, part));
      bytes += part.length;
    }
    await upload.complete(parts);
    // Replaced or its owner deleted meanwhile: the ZIP is not wanted. Its
    // claim recorded it for removal, so the sweep takes it.
    if (!(await jobs.finishExport(exportId, claim.attempt, bytes)))
      return "skipped";
    return "ready";
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
}

/**
 * Hourly (with the upload sweep): deletions still pending and exports whose
 * message was lost go back on the queue; expired and replaced exports'
 * ZIPs are removed.
 */
export async function sweepAccounts(env: Bindings, calls?: CronCalls) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const jobs = accountJobs(db);
    const pending = await jobs.deletionsPending(
      calls ? calls.remaining("accounts") : undefined
    );
    const stalled = await jobs.stalledExports(
      calls ? calls.remaining("exports") : undefined
    );
    let sent = 0;
    for (const userId of pending) {
      if (calls && !calls.take("accounts")) break;
      await env.ACCOUNT_QUEUE.send({ kind: "delete", userId }).catch(() =>
        console.error("account: sweep send failed")
      );
      sent += 1;
    }
    for (const exportId of stalled) {
      if (calls && !calls.take("exports")) break;
      await env.ACCOUNT_QUEUE.send({ kind: "export", exportId }).catch(() =>
        console.error("account: sweep send failed")
      );
      sent += 1;
    }
    // Bounded per run: what is left goes on the next hourly run.
    const expired = await jobs.sweepExports((keys) => env.FILES.delete(keys), {
      allowCall: calls ? () => calls.take("cleanup") : undefined,
    });
    if (sent || expired) {
      console.log(`account: sweep sent ${sent}, expired ${expired}`);
    }
  } finally {
    await close();
  }
}
