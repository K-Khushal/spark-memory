import {
  EMBEDDING,
  embeddingSpace,
  sendProductEvent,
  type ProductEvent,
} from "@spark/core";
import { indexingStore, openDatabase } from "@spark/db";
import {
  backoffSeconds,
  createIndexer,
  embedderFor,
  providerChain,
  type ChainOptions,
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
  memory: {
    id: string;
    indexRun: number;
    indexGeneration: string;
    indexPriority: Priority;
  }
) {
  const priority = memory.indexPriority;
  const queue = priority === "fresh" ? env.INDEX_QUEUE : env.REINDEX_QUEUE;
  try {
    await queue.send({
      memoryId: memory.id,
      run: memory.indexRun,
      generation: memory.indexGeneration,
      priority,
    });
  } catch {
    console.error("indexing: enqueue failed");
  }
}

/** What this environment's providers are (secrets and vars in wrangler.jsonc). */
export const providers = (env: Bindings): ChainOptions => ({
  fake: env.SPARK_ENV === "local" && env.INDEXING_PROVIDER === "fake",
  ai: env.AI,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiPaidTier: env.GEMINI_PAID_TIER === "true",
});

/**
 * Queues an embed job: the vectors of a Searchable Memory, made again in
 * the background (after an edited title, after `delaySeconds`, so a burst
 * of autosaves embeds once). A lost message is sent again by the sweep.
 */
export async function enqueueEmbed(
  env: Bindings,
  memory: { id: string; indexGeneration: string },
  delaySeconds?: number
) {
  try {
    await env.REINDEX_QUEUE.send(
      {
        memoryId: memory.id,
        generation: memory.indexGeneration,
        priority: "background",
        task: "embed",
      },
      delaySeconds ? { delaySeconds } : undefined
    );
  } catch {
    console.error("indexing: embed enqueue failed");
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
  const pending: { distinctId: string; event: ProductEvent }[] = [];
  try {
    const store = indexingStore(db);
    if (isDeadLetter(batch.queue)) {
      for (const message of batch.messages) {
        const { memoryId, run, generation, task } = message.body;
        // A lost embed job leaves the Memory Searchable; the sweep tries again.
        if (task !== "embed") await store.giveUp({ memoryId, run, generation });
        message.ack();
      }
      return;
    }
    const options = providers(env);
    const embedder = embedderFor(options);
    const { index } = createIndexer({
      store,
      providers: providerChain(options),
      ...(embedder && { embedder }),
      readFile: async (key) => {
        const object = await env.FILES.get(key);
        return object
          ? new Uint8Array(await new Response(object.body).arrayBuffer())
          : undefined;
      },
    });
    await Promise.all(
      batch.messages.map(async (message) => {
        const { memoryId, run, generation, priority, task } = message.body;
        let outcome: IndexOutcome;
        try {
          outcome = await index({
            memoryId,
            run,
            generation,
            priority,
            task,
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
        if (outcome.result === "searchable") {
          // Sent from the Worker, not the tile: Indexing can finish after
          // the dashboard is closed. The Capture stored whether Do Not
          // Track was off, and only the first Searchable run is counted.
          const timing = await store
            .claimFirstSearchable(memoryId, generation)
            .catch(() => undefined);
          if (timing) {
            pending.push({
              distinctId: timing.userId,
              event: {
                event: "time_to_searchable",
                properties: {
                  kind: timing.kind,
                  milliseconds: timing.milliseconds,
                },
              },
            });
          }
        }
        console.log(`indexing: ${task ?? priority} ${outcome.result}`);
      })
    );
  } finally {
    await close();
  }
  // After the database is closed: a slow capture call must not hold a connection.
  await Promise.all(
    pending.map((item) =>
      sendProductEvent({
        key: env.POSTHOG_KEY,
        host: env.POSTHOG_HOST,
        distinctId: item.distinctId,
        event: item.event,
        fetch,
        signal: AbortSignal.timeout(2_000),
      })
    )
  );
}

/** Memories left Indexing (a message lost or never sent) go back on the background queue. */
export async function requeueStalled(env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const store = indexingStore(db);
    // Past the budget, background work is waiting on purpose (with its own
    // delayed message): only fresh work, which the budget never holds, goes.
    const spent =
      (await store.spentTodayMicros()) >= (await store.dailyBudgetMicros());
    const stalled = (await store.stalled()).filter(
      (m) => !spent || m.priority === "fresh"
    );
    for (const { id, run, generation, priority } of stalled) {
      await enqueue(env, {
        id,
        indexRun: run,
        indexGeneration: generation,
        indexPriority: priority,
      });
    }
    if (stalled.length) console.log(`indexing: re-enqueued ${stalled.length}`);
    // Vectors missing (an embedding that failed) or stale (a new model or
    // size, an edited title): made again in the background, within budget.
    const embedder = embedderFor(providers(env));
    if (!embedder || spent) return;
    const stale = await store.staleVectors(
      embeddingSpace(embedder.model, embedder.dimensions),
      EMBEDDING.sweepBatch
    );
    for (const { id, generation } of stale) {
      await enqueueEmbed(env, { id, indexGeneration: generation });
    }
    if (stale.length) console.log(`indexing: re-embedding ${stale.length}`);
  } finally {
    await close();
  }
}
