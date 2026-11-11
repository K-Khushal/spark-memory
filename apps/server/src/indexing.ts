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
 * Queues the Memory for Indexing. Cloudflare Queues has no priorities, so
 * fresh Captures and Retry have their own queue and background re-indexing
 * another (wrangler.jsonc). A message that fails to send leaves the Memory
 * Indexing, and the hourly sweep sends it again: the Capture still stands.
 */
export async function enqueue(
  env: Bindings,
  memoryId: string,
  priority: Priority
) {
  const queue = priority === "fresh" ? env.INDEX_QUEUE : env.REINDEX_QUEUE;
  try {
    await queue.send({ memoryId, priority });
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

/** The dead-letter queue: messages the platform gave up on (after max_retries). */
const isDeadLetter = (queue: string) => queue.includes("-failed");

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
        await store.failCurrent(message.body.memoryId, "unavailable");
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
        const { memoryId, priority } = message.body;
        let outcome: IndexOutcome;
        try {
          outcome = await index({
            memoryId,
            priority,
            attempt: message.attempts,
          });
        } catch {
          // The database, most likely: the same message, later.
          outcome = {
            status: "retry",
            delaySeconds: backoffSeconds(message.attempts),
          };
        }
        if (outcome.status === "retry") {
          message.retry({ delaySeconds: outcome.delaySeconds });
        } else if (outcome.status === "paused") {
          // Waiting on the budget is not an attempt: a new message, later.
          await env.REINDEX_QUEUE.send(message.body, {
            delaySeconds: outcome.delaySeconds,
          }).then(
            () => message.ack(),
            () => message.retry({ delaySeconds: 3600 })
          );
        } else {
          message.ack();
        }
        console.log(`indexing: ${priority} ${outcome.status}`);
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
    const ids = await indexingStore(db).stalled();
    for (const id of ids) await enqueue(env, id, "background");
    if (ids.length) console.log(`indexing: re-enqueued ${ids.length}`);
  } finally {
    await close();
  }
}
