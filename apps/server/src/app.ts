import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { captureException } from "@sentry/cloudflare";
import { redact } from "@spark/auth";
import type { AppEnv } from "./env";
import { withAuth } from "./auth";
import { discovery, mcp } from "./mcp";
import { assistantAuth } from "./assistant-auth";
import { routes } from "./routes";

const api = new Hono<AppEnv>()
  .basePath("/api")
  // Better Auth owns /api/auth/* (sessions, email codes, social sign-in).
  .on(["GET", "POST"], "/auth/*", withAuth, (c) =>
    c.var.auth.handler(c.req.raw)
  )
  .route("/", routes)
  .route("/", mcp)
  .route("/", assistantAuth);

export const app = new Hono<AppEnv>()
  .route("/", discovery)
  .route("/", api)
  .onError((error, c) => {
    // A body the validator cannot parse (malformed JSON, invalid UTF-8) is
    // the client's mistake, answered like any other invalid request.
    if (error instanceof HTTPException && error.status < 500)
      return c.json({ ok: false, error: "invalid" } as const, error.status);
    // Hono turns thrown errors into responses, so report them here.
    // A no-op when Sentry is off.
    // Sentry scrubs through @spark/core; the log line is redacted, because a
    // failed query's message carries its parameters.
    captureException(error);
    console.error(`unhandled error: ${redact(error)}`);
    return c.json({ ok: false, error: "internal_error" } as const, 500);
  });

/** The API's type, consumed by @spark/api-client for end-to-end type safety. */
export type AppType = typeof app;
