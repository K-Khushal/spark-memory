import { Hono } from "hono";
import { ADMIN_USERS_LIMIT, openAdmin } from "@spark/db";
import { parseDailyBudgetMicros } from "@spark/core";
import type { AppEnv } from "./env";
import { requireAdmin, withAuth, type UserVariables } from "./auth";

/** Page size for the per-person list. Omitted query params use the defaults. */
function pageOf(limitRaw?: string, offsetRaw?: string) {
  const limit = limitRaw === undefined ? ADMIN_USERS_LIMIT : Number(limitRaw);
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_USERS_LIMIT) {
    return undefined;
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    return undefined;
  }
  return { limit, offset };
}

/** Costs, usage and the daily budget. Every route is admin-only. */
export const admin = new Hono<AppEnv & { Variables: UserVariables }>()
  .use(withAuth, requireAdmin)
  .use(async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
  })
  .get("/summary", async (c) => {
    const view = openAdmin(c.var.db);
    const [budget, spend] = await Promise.all([view.budget(), view.spend()]);
    return c.json({ budget, spend });
  })
  .get("/users", async (c) => {
    const page = pageOf(c.req.query("limit"), c.req.query("offset"));
    if (!page) return c.json({ ok: false, error: "invalid" } as const, 400);
    return c.json(await openAdmin(c.var.db).users(page.limit, page.offset));
  })
  .put("/budget", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = parseDailyBudgetMicros(
      body && typeof body === "object" && "limitMicros" in body
        ? body.limitMicros
        : undefined
    );
    if (!parsed.ok)
      return c.json({ ok: false, error: "invalid" } as const, 400);
    const budget = await openAdmin(c.var.db).setDailyBudget(
      parsed.micros,
      c.var.user.id
    );
    return c.json({ budget });
  });
