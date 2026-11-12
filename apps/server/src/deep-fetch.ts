import { DEEP_FETCH } from "@spark/core";
import {
  deepFetchStore,
  indexingStore,
  openDatabase,
  openLibrary,
} from "@spark/db";
import {
  cloudflareBrowser,
  cloudRunFetcher,
  createDeepFetch,
  createDeepFetchWorker,
  fakeEngine,
  type Claim,
  type Fetched,
} from "@spark/deep-fetch";
import { backoffSeconds, dohResolver } from "@spark/indexing";
import type { CronCalls } from "./cron-budget";
import type { Bindings, DeepFetchMessage } from "./env";
import { FILE_CACHE_CONTROL } from "./files";
import { enqueueDeepFetch } from "./deep-fetch-queue";
import { enqueue } from "./indexing";

/** Deep fetch's engines for this environment; a kind without one is Unavailable. */
export function deepFetchFor(env: Bindings) {
  const web: typeof fetch = (input, init) => fetch(input, init);
  if (env.SPARK_ENV === "local" && env.DEEP_FETCH_PROVIDER === "fake") {
    // The local Worker's stand-in: a page's rendered text, a transcript.
    const engine = fakeEngine(({ kind }) =>
      kind === "video"
        ? {
            ok: true,
            seconds: 1,
            transcript: [{ seconds: 5, text: "Spark found these words." }],
          }
        : {
            ok: true,
            seconds: 1,
            text: "Spark found these words in the page. ".repeat(10),
            metadata: { title: "Rendered Page" },
          }
    );
    return createDeepFetch({ page: engine, media: engine });
  }
  return createDeepFetch({
    ...(env.CLOUDFLARE_ACCOUNT_ID &&
      env.BROWSER_RENDERING_TOKEN && {
        page: cloudflareBrowser({
          accountId: env.CLOUDFLARE_ACCOUNT_ID,
          apiToken: env.BROWSER_RENDERING_TOKEN,
          fetch: web,
          resolve: dohResolver(web),
        }),
      }),
    ...(env.FETCHER_URL &&
      env.FETCHER_TOKEN && {
        media: cloudRunFetcher({
          url: env.FETCHER_URL,
          token: env.FETCHER_TOKEN,
          fetch: web,
        }),
      }),
  });
}

/** The parts of a queue batch the consumer uses (typed structurally, like env.ts). */
export type DeepFetchBatch = {
  queue: string;
  messages: readonly {
    body: DeepFetchMessage;
    attempts: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }[];
};

/**
 * The Deep fetch queue consumer (ADR-0010). One message is one attempt at
 * one Memory; the job (`createDeepFetchWorker`) decides what it means. A
 * Memory that was found something for goes back to Indexing; one that is
 * waiting (retry, daily limit, free tier) is sent again for when it is due.
 * Logs carry outcomes only, never URLs, text or errors from a page.
 */
export async function consumeDeepFetch(batch: DeepFetchBatch, env: Bindings) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const keepScreenshot = async (
      claim: Claim,
      shot: NonNullable<Fetched["screenshot"]>
    ) => {
      const library = openLibrary(db, claim.userId);
      const slot = await library.prepareScreenshot(
        claim.memoryId,
        shot.bytes.byteLength
      );
      if (!slot) return false;
      if ("refused" in slot) return false;
      if ("already" in slot) return true;
      await env.FILES.put(slot.key, shot.bytes.slice().buffer, {
        httpMetadata: {
          contentType: "image/jpeg",
          cacheControl: FILE_CACHE_CONTROL,
        },
      });
      const recorded = await library.recordScreenshot(claim.memoryId, {
        key: slot.key,
        bytes: shot.bytes.byteLength,
        width: shot.width,
        height: shot.height,
      });
      // The row is what makes it the Memory's; an object nobody points at goes.
      if (!recorded) await env.FILES.delete(slot.key).catch(() => {});
      return recorded;
    };
    const { run } = createDeepFetchWorker({
      store: deepFetchStore(db),
      ai: indexingStore(db),
      deepFetch: deepFetchFor(env),
      keepScreenshot,
    });
    await Promise.all(
      batch.messages.map(async (message) => {
        let outcome;
        try {
          outcome = await run(message.body);
        } catch {
          // The database, most likely. The lease keeps a duplicate out; if
          // retries run out, the hourly sweep takes it once the lease ends.
          message.retry({ delaySeconds: backoffSeconds(message.attempts) });
          console.error("deep fetch: retrying after an error");
          return;
        }
        if (outcome.result === "done" && outcome.reindex) {
          await enqueue(env, outcome.reindex);
        } else if (outcome.result === "later") {
          await enqueueDeepFetch(env, {
            ...message.body,
            delaySeconds: outcome.delaySeconds,
          });
        }
        message.ack();
        console.log(`deep fetch: ${outcome.result}`);
      })
    );
  } finally {
    await close();
  }
}

/**
 * The hourly sweep: Deep fetches that are due and were never delivered (a
 * message lost, a wait longer than a queue may delay, a job that died with
 * its lease) are sent now.
 */
export async function requeueDeepFetches(env: Bindings, calls?: CronCalls) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    const room = calls?.remaining("deepFetch");
    const due = await deepFetchStore(db).due(
      Math.min(DEEP_FETCH.sweepBatch, room ?? DEEP_FETCH.sweepBatch)
    );
    let sent = 0;
    for (const target of due) {
      if (calls && !calls.take("deepFetch")) break;
      await enqueueDeepFetch(env, target);
      sent += 1;
    }
    if (sent) console.log(`deep fetch: re-enqueued ${sent}`);
  } finally {
    await close();
  }
}
