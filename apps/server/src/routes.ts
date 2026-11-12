import { extensionCors, sameOrigin } from "./origin";
import { Hono } from "hono";
import { isVerifiedAdmin, publicAnalytics } from "@spark/core";
import { checkDatabase } from "@spark/db";
import type { AppEnv } from "./env";
import { account } from "./account";
import { admin } from "./admin";
import { memories } from "./memories";
import { FILE_CACHE_CONTROL, usesLocalFiles, verifyLocalUrl } from "./files";
import {
  readDevOutbox,
  requireUser,
  socialProvidersFor,
  usesDevOutbox,
  withAuth,
} from "./auth";

export const routes = new Hono<AppEnv>()
  .get("/health", async (c) => {
    const db = await checkDatabase(c.env.HYPERDRIVE.connectionString);
    if (db.ok) return c.json({ ok: true, service: "spark", db: "ok" } as const);
    // Only the failure category is logged: driver messages carry host and port.
    console.error(`health: database unreachable (${db.reason})`);
    return c.json(
      { ok: false, service: "spark", db: "unreachable" } as const,
      503
    );
  })
  // Public: what the sign-in screen offers.
  .get("/sign-in-options", (c) =>
    c.json({
      socialProviders: socialProvidersFor(c.env),
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    })
  )
  .get(
    "/me",
    extensionCors,
    sameOrigin({ extension: true }),
    withAuth,
    requireUser,
    (c) => {
      const { emailVerified, ...user } = c.var.user;
      return c.json({
        ...user,
        admin: isVerifiedAdmin(
          { email: user.email, emailVerified },
          c.env.ADMIN_EMAILS
        ),
      });
    }
  )
  // Public: the dashboard decides whether to load product analytics.
  // The key is a PostHog project key; nothing here is a person or a Memory.
  // A host that is not https never carries a key.
  .get("/analytics", (c) =>
    c.json(
      publicAnalytics({
        key: c.env.POSTHOG_KEY,
        host: c.env.POSTHOG_HOST,
      })
    )
  )
  .route("/admin", admin)
  // Local development only (never with Resend configured, never deployed).
  .get("/dev/sign-in-code", (c) => {
    const code =
      usesDevOutbox(c.env, c.req.url) &&
      readDevOutbox(c.req.query("email") ?? "");
    return code ? c.json({ code }) : c.notFound();
  })
  // Local development only: stands in for R2's presigned URLs (files.ts).
  .on(["GET", "PUT"], "/local-files/*", async (c) => {
    if (!usesLocalFiles(c.env, c.req.url)) return c.notFound();
    const key = await verifyLocalUrl(c.env.BETTER_AUTH_SECRET, c.req.raw);
    if (!key) return c.json({ ok: false, error: "forbidden" } as const, 403);
    if (c.req.method === "PUT") {
      const body = await c.req.arrayBuffer();
      if (body.byteLength !== Number(c.req.header("content-length"))) {
        return c.json({ ok: false, error: "invalid" } as const, 400);
      }
      await c.env.FILES.put(key, body, {
        httpMetadata: {
          contentType: c.req.header("content-type") ?? "",
          cacheControl: FILE_CACHE_CONTROL,
        },
      });
      return c.body(null, 200);
    }
    const object = await c.env.FILES.get(key);
    if (!object) return c.notFound();
    return c.body(object.body, 200, {
      "content-type": object.httpMetadata?.contentType ?? "",
      "cache-control": FILE_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
      ...(object.httpMetadata?.contentDisposition && {
        "content-disposition": object.httpMetadata.contentDisposition,
      }),
    });
  })
  .route("/", memories)
  .route("/", account);
