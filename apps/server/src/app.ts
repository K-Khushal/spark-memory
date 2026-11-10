import { Hono } from "hono";
import { captureException } from "@sentry/cloudflare";
import type { AppEnv } from "./env";
import { withAuth } from "./auth";
import { routes } from "./routes";

export const app = new Hono<AppEnv>()
  .basePath("/api")
  // Better Auth owns /api/auth/* (sessions, email codes, social sign-in).
  .on(["GET", "POST"], "/auth/*", withAuth, (c) =>
    c.var.auth.handler(c.req.raw)
  )
  .route("/", routes)
  .onError((error, c) => {
    // Hono turns thrown errors into responses, so report them here.
    // A no-op when Sentry is off.
    captureException(error);
    console.error(error);
    return c.json({ ok: false, error: "internal_error" } as const, 500);
  });

/** The API's type, consumed by @spark/api-client for end-to-end type safety. */
export type AppType = typeof app;
