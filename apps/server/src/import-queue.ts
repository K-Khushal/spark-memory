import { openImports, type Database } from "@spark/db";
import type { Bindings, ImportMessage } from "./env";

export async function sendImport(
  env: Bindings,
  body: ImportMessage,
  delaySeconds = 2
) {
  try {
    await env.IMPORT_QUEUE.send(body, { delaySeconds });
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
