import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** At most eight exact store origins; malformed configuration trusts none. */
export function extensionOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const origins = value.split(",").map((origin) => origin.trim());
  if (
    origins.length > 8 ||
    origins.some(
      (origin) =>
        !/^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(
          origin
        )
    )
  )
    return [];
  return [...new Set(origins)];
}
const isExtension = (origin: string | undefined) =>
  /^(chrome|moz)-extension:/.test(origin ?? "");

const dashboardOrigin = (c: {
  env: AppEnv["Bindings"];
  req: { url: string };
}) => new URL(c.env.BETTER_AUTH_URL || c.req.url).origin;

/**
 * Cookie-authenticated changes come from Spark's own pages. Memory routes
 * and /me explicitly opt into the pinned extension origin. SameSite=Lax cookies still ride along
 * from other sites on the same registrable domain, so this is the CSRF
 * check. Extension reads also require opt-in. A change with no Origin is
 * refused (browsers always send it on these methods).
 */
export const sameOrigin = ({
  extension = false,
}: { extension?: boolean } = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const origin = c.req.header("origin");
    const pinned = extension ? extensionOrigins(c.env.EXTENSION_ORIGIN) : [];
    if (isExtension(origin) && !pinned.includes(origin!)) {
      return c.json({ ok: false, error: "forbidden" } as const, 403);
    }
    if (READS.has(c.req.method)) return next();
    const allowed = new Set([dashboardOrigin(c), ...pinned]);
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
  const allowed = extensionOrigins(c.env.EXTENSION_ORIGIN);
  const origin = c.req.header("origin");
  if (isExtension(origin) && !allowed.includes(origin!)) {
    return c.json({ ok: false, error: "forbidden" } as const, 403);
  }
  if (!origin || !allowed.includes(origin)) return next();
  c.header("Access-Control-Allow-Origin", origin);
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
