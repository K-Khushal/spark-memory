import { INDEXING } from "@spark/core";
import { indexingStore, openDatabase } from "@spark/db";
import {
  backoffSeconds,
  createIndexer,
  providerChain,
  type IndexOutcome,
  type Priority,
} from "@spark/indexing";
import type { Bindings, IndexMessage } from "./env";

/**
 * Queues the Memory's current run for Indexing, on the queue its run
 * belongs to (`indexPriority`, set by the Library). Cloudflare Queues has
 * no priorities, so fresh Captures (and a Retry or opt-in, once a Memory a
 * day) have their own queue and background re-indexing another
 * (wrangler.jsonc). A message that fails to send leaves the Memory
 * Indexing, and the hourly sweep sends it again: the Capture still stands.
 */
export async function enqueue(
  env: Bindings,
  memory: { id: string; indexRun: number; indexPriority: Priority }
) {
  const priority = memory.indexPriority;
  const queue = priority === "fresh" ? env.INDEX_QUEUE : env.REINDEX_QUEUE;
  try {
    await queue.send({ memoryId: memory.id, run: memory.indexRun, priority });
  } catch {
    console.error("indexing: enqueue failed");
  }
}

/** The parts of a queue batch the consumer uses (typed structurally, like env.ts). */
export type IndexBatch = {
  queue: string;
  messages: readonly {
    body: IndexMessage;
    attempts: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }[];
};

/**
 * The dead-letter queue (`spark-index-failed-<env>` in wrangler.jsonc):
 * messages the platform gave up on after max_retries.
 */
const isDeadLetter = (queue: string) => queue.startsWith("spark-index-failed");

/**
 * The queue consumer for both Indexing queues and the dead-letter queue.
 * Every message is idempotent (see `indexingStore`). Logs carry outcomes
 * only, never content, prompts or model output.
 */
export async function consumeIndexing(batch: IndexBatch, env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const store = indexingStore(db);
    if (isDeadLetter(batch.queue)) {
      for (const message of batch.messages) {
        const { memoryId, run } = message.body;
        await store.fail(memoryId, run, "unavailable");
        message.ack();
      }
      return;
    }
    const { index } = createIndexer({
      store,
      providers: providerChain({
        fake: env.SPARK_ENV === "local" && env.INDEXING_PROVIDER === "fake",
        ai: env.AI,
        geminiApiKey: env.GEMINI_API_KEY,
        geminiPaidTier: env.GEMINI_PAID_TIER === "true",
      }),
      readFile: async (key) => {
        const object = await env.FILES.get(key);
        return object
          ? new Uint8Array(await new Response(object.body).arrayBuffer())
          : undefined;
      },
    });
    await Promise.all(
      batch.messages.map(async (message) => {
        const { memoryId, run, priority } = message.body;
        let outcome: IndexOutcome;
        try {
          outcome = await index({
            memoryId,
            run,
            priority,
            attempt: message.attempts,
          });
        } catch {
          // The database, most likely: the same message, later.
          outcome = {
            result: "retry",
            delaySeconds: backoffSeconds(message.attempts),
          };
        }
        if (outcome.result === "retry") {
          message.retry({ delaySeconds: outcome.delaySeconds });
        } else if (outcome.result === "paused") {
          // Waiting on the budget is not an attempt: a new message, later.
          // If that cannot be sent, the hourly sweep sends it once the
          // budget allows; a retry here would count towards dead-lettering.
          await env.REINDEX_QUEUE.send(message.body, {
            delaySeconds: outcome.delaySeconds,
          }).catch(() => console.error("indexing: pause not re-sent"));
          message.ack();
        } else {
          message.ack();
        }
        console.log(`indexing: ${priority} ${outcome.result}`);
      })
    );
  } finally {
    await close();
  }
}

/** Memories left Indexing (a message lost or never sent) go back on the background queue. */
export async function requeueStalled(env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const store = indexingStore(db);
    // Past the budget, background work is waiting on purpose (with its own
    // delayed message): only fresh work, which the budget never holds, goes.
    const spent =
      (await store.spentTodayMicros()) >= INDEXING.dailyBudgetMicros;
    const stalled = (await store.stalled()).filter(
      (m) => !spent || m.priority === "fresh"
    );
    for (const { id, run, priority } of stalled) {
      await enqueue(env, { id, indexRun: run, indexPriority: priority });
    }
    if (stalled.length) console.log(`indexing: re-enqueued ${stalled.length}`);
  } finally {
    await close();
  }
}
