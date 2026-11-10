import { Hono } from "hono";
import { checkDatabase } from "@spark/db";
import type { AppEnv } from "./env";

export const routes = new Hono<AppEnv>().get("/health", async (c) => {
  const db = await checkDatabase(c.env.HYPERDRIVE.connectionString);
  if (db.ok) return c.json({ ok: true, service: "spark", db: "ok" } as const);
  // Only the failure category is logged: driver messages carry host and port.
  console.error(`health: database unreachable (${db.reason})`);
  return c.json(
    { ok: false, service: "spark", db: "unreachable" } as const,
    503
  );
});
