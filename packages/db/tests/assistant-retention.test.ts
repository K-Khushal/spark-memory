import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openDatabase, type Database } from "../index";
import { assistantStore } from "../assistants";
import { newUser, removeUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;
let db: Database;
let close: () => Promise<void>;
const users: string[] = [];
beforeAll(() => {
  if (databaseUrl) ({ db, close } = openDatabase(databaseUrl));
});
afterAll(async () => {
  if (!db) return;
  for (const id of users) await removeUser(db, id);
  await close();
});

it.skipIf(!databaseUrl)(
  "hourly retention batches across owners, keeping recent revoked calls and 90 days of active calls",
  async () => {
    const store = assistantStore(db);
    for (let i = 0; i < 2; i++) {
      const userId = await newUser(db);
      users.push(userId);
      const token = crypto.randomUUID();
      await store.issue(userId, token, "Active", crypto.randomUUID());
      for (const [assistant, age] of [
        [token, 91],
        [token, 89],
        ["revoked", 31],
        ["revoked", 29],
      ] as const)
        await db.execute(sql`insert into assistant_activity(user_id, assistant_id, assistant, tool, result_count, occurred_at)
        values (${userId}, ${assistant}, ${String(age)}, 'search_memories', 1, now() - ${age} * interval '1 day')`);
    }
    await store.sweep(2);
    const remaining = async () =>
      (
        await Promise.all(
          users.map(async (id) => (await store.activity(id)).activity)
        )
      ).flat();
    expect(await remaining()).toHaveLength(6);
    await store.sweep(2);
    expect((await remaining()).map((a) => a.assistant).sort()).toEqual([
      "29",
      "29",
      "89",
      "89",
    ]);
  }
);

it.skipIf(!databaseUrl)(
  "keeps rotated OAuth activity while its owner's grant is active, then applies revoked retention",
  async () => {
    const store = assistantStore(db);
    const userId = await newUser(db);
    const otherId = await newUser(db);
    users.push(userId, otherId);
    const clientId = crypto.randomUUID();
    await store.register({ id: clientId, name: "OAuth", redirects: [] });
    try {
      await db.execute(sql`insert into assistant_grant(id, user_id, client_id, resource)
      values (${crypto.randomUUID()}, ${userId}, ${clientId}, 'http://localhost/api/mcp')`);
      for (const owner of [userId, otherId])
        await db.execute(sql`insert into assistant_activity(user_id, client_id, assistant_id, assistant, tool, result_count, occurred_at)
        values (${owner}, ${clientId}, ${`client:${clientId}`}, 'OAuth', 'search_memories', 1, now() - interval '31 days')`);
      await store.sweep();
      expect((await store.activity(userId)).activity).toHaveLength(1);
      expect((await store.activity(otherId)).activity).toHaveLength(0);
      await store.revoke(userId, `client:${clientId}`);
      await store.sweep();
      // Revocation starts the grace period; old calls remain for thirty days.
      expect((await store.activity(userId)).activity).toHaveLength(1);
      await db.execute(
        sql`update assistant_revocation set revoked_at = now() - interval '31 days' where user_id = ${userId}`
      );
      await store.sweep();
      expect((await store.activity(userId)).activity).toHaveLength(0);
    } finally {
      await db.execute(
        sql`delete from assistant_client where id = ${clientId}`
      );
    }
  }
);
