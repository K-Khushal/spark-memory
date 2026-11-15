import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Bindings, RateLimiter } from "./env";
import type { UserVariables } from "./auth";

/**
 * Cloudflare's Rate Limiting binding counts per period of 10 or 60 seconds
 * (docs/research/rate-limits.md); the periods and limits live in
 * wrangler.jsonc, which is the one place they can be set. This is the
 * period they use, so Retry-After tells a client how long a window lasts.
 */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * The bindings a route can be limited by. Capture and search are the busy
 * ones; EDIT covers every other write to the Library (an edit rewrites the
 * Memory's words), OPT_OUT the AI opt-out toggle (turning it off starts
 * Indexing again), IMAGE_SEARCH a search by image (a paid embedding) and
 * TOKEN the anonymous OAuth token endpoint, by network address.
 */
export type Limiter =
  | "CAPTURE_LIMITER"
  | "SEARCH_LIMITER"
  | "EDIT_LIMITER"
  | "OPT_OUT_LIMITER"
  | "IMAGE_SEARCH_LIMITER"
  | "TOKEN_LIMITER";

/**
 * Per signed-in person, after auth: 429 with Retry-After once the person's
 * count for this limiter is spent. A Worker with no binding (local
 * development, tests) does not limit. The binding is approximate and per
 * location, so the daily Capture count stays the strict limit.
 */
export const rateLimited = (name: Limiter) =>
  createMiddleware<AppEnv & { Variables: UserVariables }>(async (c, next) => {
    const refused = await limitExceeded(c, c.env, c.var.user.id, name);
    return refused ?? next();
  });

/**
 * For a route that knows only after reading its body which limit applies:
 * the 429 answer once the person's count is spent, else undefined.
 */
export async function limitExceeded<E extends Env>(
  c: Context<E>,
  env: Bindings,
  userId: string,
  name: Limiter
) {
  const limiter: RateLimiter | undefined = env[name];
  if (!limiter) return undefined;
  const { success } = await limiter.limit({ key: userId });
  if (success) return undefined;
  c.header("Retry-After", String(RATE_LIMIT_PERIOD_SECONDS));
  return c.json({ ok: false, error: "rate_limited" } as const, 429);
}

/**
 * For a route with no signed-in person (the OAuth token endpoint): 429 with
 * Retry-After once the caller's address has used its count. It runs before
 * anything else, so a refused request never reaches the database.
 */
export const ipLimited = (name: Limiter) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header("cf-connecting-ip") ?? "unknown";
    const refused = await limitExceeded(c, c.env, key, name);
    return refused ?? next();
  });
