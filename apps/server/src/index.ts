import {
  consumeImports,
  requeueImports,
  type ImportQueueBatch,
} from "./imports";
import type { ImportMessage } from "./env";
import { withSentry } from "@sentry/cloudflare";
import { app } from "./app";
import type {
  AccountMessage,
  Bindings,
  DeepFetchMessage,
  IndexMessage,
} from "./env";
import { consumeAccount, sweepAccounts } from "./account-jobs";
import {
  consumeDeepFetch,
  requeueDeepFetches,
  type DeepFetchBatch,
} from "./deep-fetch";
import { consumeIndexing, requeueStalled, type IndexBatch } from "./indexing";
import { sentryOptions } from "./sentry";
import { cronCalls } from "./cron-budget";
import { sweep } from "./sweep";

export type { AppType } from "./app";

const withoutSentry = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  // Hourly (wrangler.jsonc → triggers): image uploads that never finished,
  // Memories whose Indexing message was lost, and account jobs to resume.
  scheduled: (_controller, env, ctx) => {
    const calls = cronCalls();
    ctx.waitUntil(
      Promise.all([
        sweep(env, undefined, calls),
        requeueStalled(env, calls),
        requeueDeepFetches(env, calls),
        sweepAccounts(env, calls),
        requeueImports(env, calls),
      ])
    );
  },
  // The account queue (src/account-jobs.ts); the Deep fetch queue
  // (src/deep-fetch.ts); both Indexing queues and their dead-letter queue
  // (src/indexing.ts).
  queue: (batch, env) =>
    batch.queue.startsWith("spark-import")
      ? consumeImports(batch as unknown as ImportQueueBatch, env)
      : batch.queue.startsWith("spark-account")
        ? consumeAccount(batch as MessageBatch<AccountMessage>, env)
        : batch.queue.startsWith("spark-deepfetch")
          ? consumeDeepFetch(batch as unknown as DeepFetchBatch, env)
          : consumeIndexing(batch as unknown as IndexBatch, env),
} satisfies ExportedHandler<Bindings, QueueMessage>;

type QueueMessage =
  IndexMessage | AccountMessage | DeepFetchMessage | ImportMessage;

const withSentryOn = withSentry((env: Bindings) => sentryOptions(env), {
  ...withoutSentry,
});

// Sentry is never initialised for an environment without a DSN.
export default {
  fetch: (request, env, ctx) =>
    env.SENTRY_DSN
      ? withSentryOn.fetch(request, env, ctx)
      : withoutSentry.fetch(request, env, ctx),
  scheduled: (controller, env, ctx) =>
    env.SENTRY_DSN
      ? withSentryOn.scheduled(controller, env, ctx)
      : withoutSentry.scheduled(controller, env, ctx),
  queue: (batch, env) =>
    env.SENTRY_DSN
      ? withSentryOn.queue(batch, env)
      : withoutSentry.queue(batch, env),
} satisfies ExportedHandler<Bindings, QueueMessage>;
