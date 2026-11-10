import { withSentry } from "@sentry/cloudflare";
import { app } from "./app";
import type { Bindings } from "./env";
import { sentryOptions } from "./sentry";

export type { AppType } from "./app";

const handler = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Bindings>;

// Sentry wraps the handler only when this environment has a DSN.
const observed = withSentry((env: Bindings) => sentryOptions(env)!, {
  ...handler,
});

export default {
  fetch: (request, env, ctx) =>
    env.SENTRY_DSN
      ? observed.fetch(request, env, ctx)
      : handler.fetch(request, env, ctx),
} satisfies ExportedHandler<Bindings>;
