import { DEEP_FETCH } from "@spark/core";
import type { DeepFetchTarget } from "@spark/db";
import type { Bindings } from "./env";

/**
 * Sends a Deep fetch job, due in `delaySeconds`. A wait longer than a queue
 * may delay a message is not sent: the database says when it is due, and the
 * hourly sweep sends it then. A message that fails to send is also left to
 * the sweep.
 */
export async function enqueueDeepFetch(
  env: Bindings,
  target: Pick<DeepFetchTarget, "memoryId" | "generation" | "run"> & {
    delaySeconds?: number;
  }
) {
  const { delaySeconds = 0, ...message } = target;
  if (delaySeconds > DEEP_FETCH.maxQueueDelaySeconds) return;
  try {
    await env.DEEP_FETCH_QUEUE.send(
      message,
      delaySeconds > 0 ? { delaySeconds } : undefined
    );
  } catch {
    console.error("deep fetch: enqueue failed");
  }
}
