import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { DAILY_BUDGET_KEY, INDEXING } from "@spark/core";
import {
  databaseUrl,
  drain,
  env,
  fakeTurnstile,
  newClient,
  signedIn,
} from "./worker";

// The admin routes: a normal person cannot read or change them, and the
// owner can. Product events go out without Memory content.
fakeTurnstile();

const json = async <T>(res: Response) => (await res.json()) as T;

describe.skipIf(!databaseUrl)("admin", () => {
  const sql = new Client({ connectionString: databaseUrl });

  beforeAll(() => sql.connect());

  afterAll(async () => {
    await sql.query(`delete from setting_change where key = $1`, [
      DAILY_BUDGET_KEY,
    ]);
    await sql.query(`delete from app_setting where key = $1`, [
      DAILY_BUDGET_KEY,
    ]);
    await sql.query(`delete from ai_call where model = $1`, ["admin-route"]);
    await sql.end().catch(() => {});
  });

  it("hides product analytics when no key is set, and publishes it when one is", async () => {
    const call = newClient();
    expect(await (await call("/api/analytics")).json()).toEqual({
      key: null,
      host: "https://us.i.posthog.com",
    });
    const configured = await call(
      "/api/analytics",
      {},
      env({ POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com" })
    );
    expect(await configured.json()).toEqual({
      key: "phc_test",
      host: "https://eu.i.posthog.com",
    });
  });

  it("refuses anonymous and ordinary people, and lets an admin read and change the budget", async () => {
    const stranger = newClient();
    expect((await stranger("/api/admin/summary")).status).toBe(401);
    expect(await (await stranger("/api/admin/summary")).json()).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(
      (
        await stranger("/api/admin/budget", {
          method: "PUT",
          json: { limitMicros: 1 },
        })
      ).status
    ).toBe(401);

    const ordinary = await signedIn();
    expect((await ordinary.call("/api/me")).status).toBe(200);
    expect(
      (await json<{ admin: boolean }>(await ordinary.call("/api/me"))).admin
    ).toBe(false);
    expect((await ordinary.call("/api/admin/summary")).status).toBe(403);
    expect(await (await ordinary.call("/api/admin/summary")).json()).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      (
        await ordinary.call("/api/admin/budget", {
          method: "PUT",
          json: { limitMicros: 2_000_000 },
        })
      ).status
    ).toBe(403);
    expect((await ordinary.call("/api/admin/users?limit=0")).status).toBe(403);

    const owner = await signedIn();
    const asOwner = env({ ADMIN_EMAILS: ` ${owner.address.toUpperCase()} ` });
    expect(
      (await json<{ admin: boolean }>(await owner.call("/api/me", {}, asOwner)))
        .admin
    ).toBe(true);

    const me = await json<{ id: string }>(
      await owner.call("/api/me", {}, asOwner)
    );
    await sql.query(
      `insert into ai_call (user_id, memory_id, day, provider, model, input_tokens, output_tokens, cost_micros)
       values ($1, gen_random_uuid(), (now() at time zone 'utc')::date, 'workers-ai', 'admin-route', 3, 4, 420)`,
      [me.id]
    );

    const summary = await owner.call("/api/admin/summary", {}, asOwner);
    expect(summary.status).toBe(200);
    const body = await json<{
      budget: { limitMicros: number; paused: boolean };
      spend: { model: string; costMicros: number; calls: number }[];
    }>(summary);
    expect(body.budget.limitMicros).toBe(INDEXING.dailyBudgetMicros);
    expect(body.spend).toContainEqual(
      expect.objectContaining({
        model: "admin-route",
        costMicros: 420,
        calls: 1,
      })
    );

    const users = await owner.call(
      "/api/admin/users?limit=1&offset=0",
      {},
      asOwner
    );
    expect(users.status).toBe(200);
    const page = await json<{
      users: { id: string; email: string }[];
      total: number;
    }>(users);
    expect(page.users).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(
      (await owner.call("/api/admin/users?limit=51", {}, asOwner)).status
    ).toBe(400);

    const saved = await owner.call(
      "/api/admin/budget",
      { method: "PUT", json: { limitMicros: 2_000_000 } },
      asOwner
    );
    expect(saved.status).toBe(200);
    expect(
      (await json<{ budget: { limitMicros: number } }>(saved)).budget
        .limitMicros
    ).toBe(2_000_000);
    const again = await owner.call("/api/admin/summary", {}, asOwner);
    expect(
      (await json<{ budget: { limitMicros: number } }>(again)).budget
        .limitMicros
    ).toBe(2_000_000);

    const rejected = await owner.call(
      "/api/admin/budget",
      { method: "PUT", json: { limitMicros: -1 } },
      asOwner
    );
    expect(rejected.status).toBe(400);
    expect(
      (
        await json<{ budget: { limitMicros: number } }>(
          await owner.call("/api/admin/summary", {}, asOwner)
        )
      ).budget.limitMicros
    ).toBe(2_000_000);

    const logged = await sql.query(
      `select changed_by, value from setting_change where key = $1 and value = '2000000'`,
      [DAILY_BUDGET_KEY]
    );
    expect(logged.rows[0]).toEqual({ changed_by: me.id, value: "2000000" });
  });

  it("shows the breaker paused at a $0 limit", async () => {
    const owner = await signedIn();
    const asOwner = env({ ADMIN_EMAILS: owner.address });
    try {
      const saved = await owner.call(
        "/api/admin/budget",
        { method: "PUT", json: { limitMicros: 0 } },
        asOwner
      );
      expect(
        (
          await json<{ budget: { limitMicros: number; paused: boolean } }>(
            saved
          )
        ).budget
      ).toMatchObject({
        limitMicros: 0,
        paused: true,
      });
    } finally {
      await sql.query(`delete from app_setting where key = $1`, [
        DAILY_BUDGET_KEY,
      ]);
    }
  });

  it("reports time to Searchable without the Memory's text", async () => {
    const seen: unknown[] = [];
    const current = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("posthog.com")) {
        seen.push(JSON.parse(String(init?.body)));
        return new Response("ok", { status: 200 });
      }
      return current!(input, init);
    });

    const { call } = await signedIn();
    const phrase = `private-phrase-${crypto.randomUUID()}`;
    const created = await call("/api/memories", {
      method: "POST",
      json: { body: phrase },
    });
    const { id } = (await created.json()) as { id: string };
    const me = (await (await call("/api/me")).json()) as {
      id: string;
      email: string;
    };
    await drain(
      id,
      env({ POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://us.i.posthog.com" })
    );

    expect(seen).toContainEqual({
      api_key: "phc_test",
      event: "time_to_searchable",
      distinct_id: me.id,
      properties: { kind: "text", milliseconds: expect.any(Number) },
    });
    const wire = JSON.stringify(seen);
    expect(wire).not.toContain(phrase);
    expect(wire).not.toContain(me.email);
  });
});
