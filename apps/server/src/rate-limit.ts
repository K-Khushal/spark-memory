import { createMiddleware } from "hono/factory";
import type { AppEnv, RateLimiter } from "./env";
import type { UserVariables } from "./auth";

/**
 * Cloudflare's Rate Limiting binding counts per period of 10 or 60 seconds
 * (docs/research/rate-limits.md); the periods and limits live in
 * wrangler.jsonc, which is the one place they can be set. This is the
 * period they use, so Retry-After tells a client how long a window lasts.
 */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

/** The two bindings a route can be limited by. */
export type Limiter = "CAPTURE_LIMITER" | "SEARCH_LIMITER";

/**
 * Per signed-in person, after auth: 429 with Retry-After once the person's
 * count for this limiter is spent. A Worker with no binding (local
 * development, tests) does not limit. The binding is approximate and per
 * location, so the daily Capture count stays the strict limit.
 */
export const rateLimited = (name: Limiter) =>
  createMiddleware<AppEnv & { Variables: UserVariables }>(async (c, next) => {
    const limiter: RateLimiter | undefined = c.env[name];
    if (limiter) {
      const { success } = await limiter.limit({ key: c.var.user.id });
      if (!success) {
        c.header("Retry-After", String(RATE_LIMIT_PERIOD_SECONDS));
        return c.json({ ok: false, error: "rate_limited" } as const, 429);
      }
    }
    return next();
  });
