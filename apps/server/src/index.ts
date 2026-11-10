import { withSentry } from "@sentry/cloudflare";
import { app } from "./app";
import type { Bindings } from "./env";
import { sentryOptions } from "./sentry";

export type { AppType } from "./app";

const withoutSentry = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
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
} satisfies ExportedHandler<Bindings>;
