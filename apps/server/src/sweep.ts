import {
  openDatabase,
  sweepAbandonedUploads,
  UPLOAD_WINDOW_HOURS,
} from "@spark/db";
import type { Bindings } from "./env";

/**
 * Removes image Memories whose upload never finished within the upload
 * window, with their objects. Batches until none are left. Only counts are
 * logged.
 */
export async function sweep(env: Bindings, now = Date.now()) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  const before = new Date(now - UPLOAD_WINDOW_HOURS * 60 * 60 * 1000);
  try {
    let total = 0;
    for (;;) {
      const swept = await sweepAbandonedUploads(db, {
        before,
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
