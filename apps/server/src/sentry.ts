import type { CloudflareOptions } from "@sentry/cloudflare";
import { sentryScrubbing } from "@spark/core/sentry";
import type { Bindings } from "./env";

/** Sentry options for this Worker, or undefined (Sentry off) without a DSN. */
export function sentryOptions(
  env: Pick<Bindings, "SENTRY_DSN" | "SPARK_ENV">
): CloudflareOptions | undefined {
  if (!env.SENTRY_DSN) return undefined;
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SPARK_ENV ?? "local",
    // Errors only on the free plan; tracing can come later.
    tracesSampleRate: 0,
    ...sentryScrubbing,
  };
}
