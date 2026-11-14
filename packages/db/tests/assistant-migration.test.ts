import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openDatabase, type Database } from "../index";
import { assistantStore } from "../assistants";
import { newUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;
let db: Database;
let close: () => Promise<void>;
let control: Client;
const name = `assistant_migration_${crypto.randomUUID().replaceAll("-", "")}`;

beforeAll(async () => {
  if (!databaseUrl) return;
  control = new Client({ connectionString: databaseUrl });
  await control.connect();
  await control.query(`CREATE DATABASE "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  ({ db, close } = openDatabase(url.href));
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  // Recreate the pre-0033 shape only in this test's isolated database.
  await db.execute(
    sql`ALTER TABLE assistant_activity DROP COLUMN assistant_id, DROP COLUMN memory_id`
  );
});

afterAll(async () => {
  if (close) await close();
  if (control) {
    try {
      // pool.end() can resolve before Postgres observes every socket close.
      // DROP waits for normal disconnects; FORCE can emit an idle-client error.
      await control.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally {
      await control.end();
    }
  }
});

it.skipIf(!databaseUrl)(
  "leaves historical personal-token calls unattributed after a name is reused",
  async () => {
    const userId = await newUser(db);
    const store = assistantStore(db);
    await db.execute(
      sql`INSERT INTO assistant_token (id, user_id, name, digest, expires_at) VALUES ('old', ${userId}, 'Solo', 'old-digest', now() + interval '1 day')`
    );
    await db.execute(
      sql`INSERT INTO assistant_activity (user_id, assistant, tool, result_count) VALUES (${userId}, 'Solo', 'search_memories', 3)`
    );
    await store.revoke(userId, "old");
    await db.execute(
      sql`INSERT INTO assistant_token (id, user_id, name, digest, expires_at) VALUES ('replacement', ${userId}, 'Solo', 'new-digest', now() + interval '1 day')`
    );
    await db.execute(
      sql.raw(
        await readFile(
          new URL(
            "../migrations/0033_assistant_activity_detail.sql",
            import.meta.url
          ),
          "utf8"
        )
      )
    );
    expect(
      await store.activity(userId, { assistantId: "replacement" })
    ).toEqual({ activity: [], next: null });
    const historical = await db.execute(
      sql`SELECT assistant_id FROM assistant_activity WHERE user_id = ${userId}`
    );
    expect(historical.rows).toEqual([{ assistant_id: null }]);
  }
);
