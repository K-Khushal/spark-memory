import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-authenticated changes come from Spark's own pages only: the
 * request's Origin must be the public origin (BETTER_AUTH_URL, the one
 * Better Auth trusts for its own routes). SameSite=Lax cookies still ride
 * along from other sites on the same registrable domain, so this is the
 * CSRF check. Reads pass; a change with no Origin is refused (browsers
 * always send it on these methods).
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (READS.has(c.req.method)) return next();
  const trusted = new URL(c.env.BETTER_AUTH_URL || c.req.url).origin;
  if (c.req.header("origin") !== trusted) {
    return c.json({ ok: false, error: "forbidden" } as const, 403);
  }
  await next();
});
