import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openDatabase, type Database } from "../index";
import { assistantStore, REGISTRATION_LIMITS } from "../assistants";
import { newUser, removeUser } from "./users";

// Anonymous OAuth registration is bounded: SEC-1.
const databaseUrl = process.env.DATABASE_URL;
let db: Database;
let close: () => Promise<void>;
const users: string[] = [];
const clients: string[] = [];
beforeAll(() => {
  if (databaseUrl) ({ db, close } = openDatabase(databaseUrl));
});
afterAll(async () => {
  if (!db) return;
  for (const id of users) await removeUser(db, id);
  for (const id of clients)
    await db.execute(sql`delete from assistant_client where id = ${id}`);
  await db.execute(
    sql`delete from rate_limit where key like 'mcp-register:t-%'`
  );
  await close();
});

const register = async (
  store: ReturnType<typeof assistantStore>,
  max?: number
) => {
  const id = crypto.randomUUID();
  clients.push(id);
  return {
    id,
    saved: await store.register({ id, name: "A", redirects: [] }, max),
  };
};
const age = (id: string, hours: number) =>
  db.execute(
    sql`update assistant_client set created_at = now() - ${hours} * interval '1 hour' where id = ${id}`
  );
const exists = async (id: string) =>
  (await db.execute(sql`select 1 from assistant_client where id = ${id}`))
    .rowCount === 1;

it.skipIf(!databaseUrl)(
  "refuses registrations while the unclaimed ones fill the global cap, and counts only live ones",
  async () => {
    const store = assistantStore(db);
    const live = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from assistant_client where claimed_at is null and created_at > now() - interval '24 hours'`
      )
    ).rows[0]!.n;
    const cap = live + 2;
    expect((await register(store, cap)).saved).toBe(true);
    const last = await register(store, cap);
    expect(last.saved).toBe(true);
    const refused = await register(store, cap);
    expect(refused.saved).toBe(false);
    expect(await exists(refused.id)).toBe(false);
    // One that aged out of its window no longer takes a place.
    await age(last.id, 25);
    expect((await register(store, cap)).saved).toBe(true);
  }
);

it.skipIf(!databaseUrl)(
  "parallel registrations cannot pass the cap together",
  async () => {
    const store = assistantStore(db);
    const live = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from assistant_client where claimed_at is null and created_at > now() - interval '24 hours'`
      )
    ).rows[0]!.n;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => register(store, live + 3))
    );
    expect(results.filter((r) => r.saved)).toHaveLength(3);
  }
);

it.skipIf(!databaseUrl)(
  "sweeps unclaimed registrations after a day in bounded batches and keeps claimed clients and live codes",
  async () => {
    const store = assistantStore(db);
    const userId = await newUser(db);
    users.push(userId);
    const stale = [
      await register(store),
      await register(store),
      await register(store),
    ];
    const claimed = await register(store);
    const coded = await register(store);
    const fresh = await register(store);
    for (const c of [...stale, claimed, coded]) await age(c.id, 30);
    await db.execute(
      sql`update assistant_client set claimed_at = now() - interval '29 hours' where id = ${claimed.id}`
    );
    await db.execute(sql`insert into assistant_code(digest, user_id, client_id, redirect, challenge, resource)
      values (${crypto.randomUUID()}, ${userId}, ${coded.id}, 'http://localhost/cb', 'c', 'r')`);
    const staleLeft = async () =>
      (await Promise.all(stale.map((c) => exists(c.id)))).filter(Boolean)
        .length;
    // Bounded: one batch removes at most `batch` (another test file may sweep too).
    expect(await store.sweepRegistrations(1)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 20 && (await staleLeft()); i++)
      await store.sweepRegistrations(500);
    expect(await staleLeft()).toBe(0);
    expect(await exists(claimed.id)).toBe(true);
    expect(await exists(coded.id)).toBe(true);
    expect(await exists(fresh.id)).toBe(true);
  }
);

it.skipIf(!databaseUrl)(
  "a grant claims the registration, so an active integration survives the sweep",
  async () => {
    const store = assistantStore(db);
    const userId = await newUser(db);
    users.push(userId);
    const { id } = await register(store);
    await store.grant({
      digest: "code-" + id,
      userId,
      clientId: id,
      redirect: "http://localhost/cb",
      challenge: "challenge",
      resource: "http://localhost/api/mcp",
    });
    const exchanged = await store.exchange({
      digest: "code-" + id,
      clientId: id,
      redirect: "http://localhost/cb",
      challenge: "challenge",
      resource: "http://localhost/api/mcp",
      tokenDigest: "token-" + id,
      refreshDigest: "refresh-" + id,
      id: crypto.randomUUID(),
    });
    expect(exchanged).toBe(true);
    await age(id, 100);
    await store.sweepRegistrations(500);
    expect(await exists(id)).toBe(true);
    expect((await store.list(userId)).map((a) => a.clientId)).toContain(id);
  }
);

it.skipIf(!databaseUrl)(
  "allows a source one registration window a day on top of the minute window",
  async () => {
    const store = assistantStore(db);
    const key = `mcp-register:t-${crypto.randomUUID()}`;
    let allowed = 0;
    for (let i = 0; i < REGISTRATION_LIMITS.perSourcePerDay + 5; i++) {
      // Reset the minute window so only the day quota can refuse.
      await db.execute(
        sql`update rate_limit set last_request = 0 where key = ${key}`
      );
      if (await store.allowRegistration(key)) allowed++;
    }
    expect(allowed).toBe(REGISTRATION_LIMITS.perSourcePerDay);
    expect(
      await store.allowRegistration(`mcp-register:t-${crypto.randomUUID()}`)
    ).toBe(true);
  }
);

it.skipIf(!databaseUrl)("keeps the per-minute window", async () => {
  const store = assistantStore(db);
  const key = `mcp-register:t-${crypto.randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: REGISTRATION_LIMITS.perSourcePerMinute + 4 }, () =>
      store.allowRegistration(key)
    )
  );
  expect(results.filter(Boolean)).toHaveLength(
    REGISTRATION_LIMITS.perSourcePerMinute
  );
});
