import { queueDelaySeconds } from "@spark/core";
import { openImports, type Database, type DeepFetchTarget } from "@spark/db";
import type { Bindings, ImportMessage } from "./env";

/**
 * Sends a Deep fetch job with a bounded delay. The database keeps its due
 * time, so an early delivery waits again. Failed sends recover in the sweep.
 */
export async function enqueueDeepFetch(
  env: Bindings,
  target: Pick<DeepFetchTarget, "memoryId" | "generation" | "run"> & {
    delaySeconds?: number;
  }
) {
  const { delaySeconds = 0, ...message } = target;
  try {
    await env.DEEP_FETCH_QUEUE.send(
      message,
      delaySeconds > 0
        ? { delaySeconds: queueDelaySeconds(delaySeconds) }
        : undefined
    );
  } catch {
    console.error("deep fetch: enqueue failed");
  }
}

export async function sendImport(
  env: Bindings,
  body: ImportMessage,
  delaySeconds = 2
) {
  try {
    await env.IMPORT_QUEUE.send(body, {
      delaySeconds: queueDelaySeconds(delaySeconds),
    });
  } catch {
    console.error("import: enqueue failed");
  }
}

/** Confirm commits before waking; a repeated confirm cannot restart the same waiting chain. */
export async function wakeImportImage(
  env: Bindings,
  db: Database,
  userId: string,
  memoryId: string
) {
  const id = await openImports(db, userId).wakeImage(memoryId);
  if (id) await sendImport(env, { id, userId });
}
