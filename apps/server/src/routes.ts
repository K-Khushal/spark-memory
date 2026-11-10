import { Hono } from "hono";
import { checkDatabase } from "@spark/db";
import type { AppEnv } from "./env";

export const routes = new Hono<AppEnv>().get("/health", async (c) => {
  const db = await checkDatabase(c.env.HYPERDRIVE.connectionString);
  if (db.ok) return c.json({ ok: true, service: "spark", db: "ok" } as const);
  // The reason goes to Workers Logs only; the public check says just "unreachable".
  console.error("health: database unreachable:", db.error);
  return c.json(
    { ok: false, service: "spark", db: "unreachable" } as const,
    503
  );
});
