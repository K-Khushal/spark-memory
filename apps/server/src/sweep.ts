import {
  openDatabase,
  SWEEP_BUDGET_MS,
  sweepAbandonedUploads,
} from "@spark/db";
import type { Bindings } from "./env";

/** R2 accepts at most this many keys in one delete. */
const R2_DELETE_KEYS = 1_000;

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
        // Exact keys captured under the lock. Aborting stops the next call;
        // a call in flight can only delete keys from that set.
        removeObjects: async (keys, signal) => {
          for (let i = 0; i < keys.length; i += R2_DELETE_KEYS) {
            if (signal.aborted)
              throw new Error("sweep: storage delete aborted");
            await env.FILES.delete(keys.slice(i, i + R2_DELETE_KEYS));
          }
        },
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
