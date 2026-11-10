import { openDatabase, sweepAbandonedUploads } from "@spark/db";
import type { Bindings } from "./env";

/**
 * Removes image Memories whose upload never finished within the upload
 * window (measured by the database's clock), with their objects. Batches
 * until none are left. Only counts are logged.
 */
export async function sweep(env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    let total = 0;
    for (;;) {
      const swept = await sweepAbandonedUploads(db, {
        removeObjects: (keys) => env.FILES.delete(keys),
      });
      total += swept;
      if (!swept) break;
    }
    if (total) console.log(`sweep: removed ${total} unfinished uploads`);
    return total;
  } finally {
    await close();
  }
}
