import { Hono } from "hono";
import { checkDatabase } from "@spark/db";
import type { AppEnv } from "./env";
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
  .get("/me", withAuth, requireUser, (c) => c.json(c.var.user))
  // Local development only (never with Resend configured, never deployed).
  .get("/dev/sign-in-code", (c) => {
    const code =
      usesDevOutbox(c.env, c.req.url) &&
      readDevOutbox(c.req.query("email") ?? "");
    return code ? c.json({ code }) : c.notFound();
  });
