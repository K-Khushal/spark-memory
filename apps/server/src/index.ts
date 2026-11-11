import { withSentry } from "@sentry/cloudflare";
import { app } from "./app";
import type { Bindings, IndexMessage } from "./env";
import { consumeIndexing, requeueStalled } from "./indexing";
import { sentryOptions } from "./sentry";
import { sweep } from "./sweep";

export type { AppType } from "./app";

const withoutSentry = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  // Hourly (wrangler.jsonc → triggers): image uploads that never finished,
  // and Memories whose Indexing message was lost.
  scheduled: (_controller, env, ctx) =>
    ctx.waitUntil(Promise.all([sweep(env), requeueStalled(env)])),
  // Both Indexing queues and their dead-letter queue (src/indexing.ts).
  queue: (batch, env) => consumeIndexing(batch, env),
} satisfies ExportedHandler<Bindings, IndexMessage>;

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
} satisfies ExportedHandler<Bindings, IndexMessage>;
