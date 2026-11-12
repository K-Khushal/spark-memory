import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A pinned extension id (Chrome and Edge). Anything wider, including
 * `chrome-extension://*`, is ignored so a bad var cannot trust every
 * extension. Firefox's `moz-extension://` id is a different shape and
 * arrives with #18.
 */
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/** The one extension origin this deployment trusts, or undefined. */
export function extensionOrigin(value: string | undefined): string | undefined {
  return value && CHROME_EXTENSION_ORIGIN.test(value) ? value : undefined;
}

const dashboardOrigin = (c: {
  env: AppEnv["Bindings"];
  req: { url: string };
}) => new URL(c.env.BETTER_AUTH_URL || c.req.url).origin;

/**
 * Cookie-authenticated changes come from Spark's own pages, or from the
 * pinned extension and nothing else. SameSite=Lax cookies still ride along
 * from other sites on the same registrable domain, so this is the CSRF
 * check. Reads pass; a change with no Origin is refused (browsers always
 * send it on these methods).
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (READS.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  const allowed = new Set(
    [dashboardOrigin(c), extensionOrigin(c.env.EXTENSION_ORIGIN)].filter(
      (value): value is string => value !== undefined
    )
  );
  if (!origin || !allowed.has(origin)) {
    return c.json({ ok: false, error: "forbidden" } as const, 403);
  }
  await next();
});

/**
 * Lets the pinned extension read credentialed responses. No other origin
 * gets these headers. A preflight from that origin is answered here, before
 * auth, and does not widen what `sameOrigin` allows.
 */
export const extensionCors = createMiddleware<AppEnv>(async (c, next) => {
  const allowed = extensionOrigin(c.env.EXTENSION_ORIGIN);
  const origin = c.req.header("origin");
  if (origin?.startsWith("chrome-extension://") && origin !== allowed) {
    return c.json({ ok: false, error: "forbidden" } as const, 403);
  }
  if (!allowed || origin !== allowed) return next();
  c.header("Access-Control-Allow-Origin", allowed);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Vary", "Origin");
  if (c.req.method !== "OPTIONS") return next();
  c.header(
    "Access-Control-Allow-Headers",
    "content-type, x-spark-user, x-spark-width, x-spark-height"
  );
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
  c.header("Access-Control-Max-Age", "600");
  return c.body(null, 204);
});
