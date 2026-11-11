import {
  openDatabase,
  SWEEP_BUDGET_MS,
  sweepAbandonedUploads,
} from "@spark/db";
import type { Bindings } from "./env";

/**
 * Removes image Memories whose upload never finished within the upload
 * window (measured by the database's clock), with their objects. One
 * owner's failure is skipped. Stops at the time budget so this hourly run
 * can also finish the account sweep beside it; what is left goes next hour.
 * Only counts are logged.
 */
export async function sweep(
  env: Bindings,
  deadline = Date.now() + SWEEP_BUDGET_MS
) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    let total = 0;
    for (;;) {
      const swept = await sweepAbandonedUploads(db, {
        removeObjects: (keys) => env.FILES.delete(keys),
        deadline,
      });
      total += swept;
      if (!swept || Date.now() >= deadline) break;
    }
    if (total) console.log(`sweep: removed ${total} unfinished uploads`);
    return total;
  } finally {
    await close();
  }
}
