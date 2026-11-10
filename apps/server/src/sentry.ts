import type { CloudflareOptions, Event } from "@sentry/cloudflare";
import type { Bindings } from "./env";

/**
 * Strips everything that can carry Memory content or personal data before an
 * event leaves the Worker: request bodies, cookies, headers, query strings
 * (search queries describe Memories), user, extra, breadcrumb messages and data.
 * Rule for callers: never put Memory content in error messages either.
 */
export function scrubEvent<T extends Event>(event: T): T {
  const { request, user: _user, extra: _extra, breadcrumbs, ...rest } = event;
  const scrubbed = { ...rest } as T;
  if (request) {
    scrubbed.request = {
      ...(request.method && { method: request.method }),
      ...(request.url && { url: request.url.split(/[?#]/)[0] }),
    };
  }
  if (breadcrumbs) {
    scrubbed.breadcrumbs = breadcrumbs.map(
      ({ message: _message, data: _data, ...crumb }) => crumb
    );
  }
  return scrubbed;
}

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
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}
