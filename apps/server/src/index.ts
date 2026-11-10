import { withSentry } from "@sentry/cloudflare";
import { app } from "./app";
import type { Bindings } from "./env";
import { sentryOptions } from "./sentry";
import { sweep } from "./sweep";

export type { AppType } from "./app";

const withoutSentry = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  // Daily (wrangler.jsonc → triggers): image uploads that never finished.
  scheduled: (_controller, env, ctx) => ctx.waitUntil(sweep(env)),
} satisfies ExportedHandler<Bindings>;

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
} satisfies ExportedHandler<Bindings>;
