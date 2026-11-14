import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase, openLibrary, schema, type Database } from "../index";
import { newUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;
const migration = new URL(
  "../migrations/0036_social_sources.sql",
  import.meta.url
);

describe.skipIf(!databaseUrl)("existing social Sources migration", () => {
  let db: Database;
  let close: () => Promise<void>;
  const databaseName = `social_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  let testUrl: string;
  let control: Client;
  beforeAll(async () => {
    control = new Client({ connectionString: databaseUrl });
    await control.connect();
    await control.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    testUrl = url.href;
    ({ db, close } = openDatabase(testUrl));
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url)
      ),
    });
  }, 30_000);
  afterAll(async () => {
    if (close) await close();
    if (control) {
      try {
        await control.query(
          `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
        );
      } finally {
        await control.end();
      }
    }
  }, 30_000);
  const owner = () => newUser(db);
  const legacy = async (
    userId: string,
    url: string,
    over: Partial<typeof schema.memory.$inferInsert> = {}
  ) => {
    const [row] = await db
      .insert(schema.memory)
      .values({
        userId,
        kind: "link",
        sourceUrl: url,
        sourceUrlNormalised: url,
        metadata: { title: "Source Title" },
        body: "Original Source text",
        title: "My Title",
        captureNote: "Kept Note",
        indexState: "searchable",
        indexRun: 4,
        revision: 2,
        ...over,
      })
      .returning();
    return row!;
  };
  const apply = async () => {
    const client = new Client({ connectionString: testUrl });
    const notices: string[] = [];
    client.on("notice", (notice) => notices.push(notice.message ?? ""));
    await client.connect();
    try {
      await client.query(await readFile(migration, "utf8"));
    } finally {
      await client.end();
    }
    return notices;
  };

  it("canonicalises X, TikTok and Instagram without losing colliding Memories", async () => {
    const userId = await owner();
    const another = await owner();
    const cases = [
      [
        "http://mobile.twitter.com/ana/status/123/photo/1?s=20",
        "https://x.com/ana/status/123",
      ],
      ["https://twitter.com/i/web/status/456", "https://x.com/i/status/456"],
      [
        "http://m.tiktok.com/@ana/video/123/?lang=en",
        "https://www.tiktok.com/@ana/video/123",
      ],
      [
        "https://tiktok.com/@ana/photo/456",
        "https://www.tiktok.com/@ana/photo/456",
      ],
      [
        "https://instagram.com/ana/p/Ab_cd/?img_index=2",
        "https://www.instagram.com/p/Ab_cd/",
      ],
      [
        "https://instagram.com/ana/reels/Ab-12/?igsh=abc",
        "https://www.instagram.com/reel/Ab-12/",
      ],
    ];
    const rows = [];
    for (const [url, target] of cases)
      rows.push({ row: await legacy(userId, url!), target });
    const canonical = await legacy(userId, "https://x.com/ben/status/789");
    const collision = await legacy(
      userId,
      "https://twitter.com/ben/status/789?s=20"
    );
    const separate = await legacy(
      another,
      "https://twitter.com/ben/status/789?s=20"
    );
    const lookalike = await legacy(
      userId,
      "https://twitter.com.evil.test/ana/status/123"
    );
    const short = await legacy(userId, "https://vm.tiktok.com/short/");
    const notices = await apply();
    expect(notices).toContain(
      "social URL migration: skipped 1 conflicting Memories"
    );
    for (const { row, target } of rows) {
      const [changed] = await db
        .select()
        .from(schema.memory)
        .where(eq(schema.memory.id, row.id));
      expect(changed).toEqual({ ...row, sourceUrlNormalised: target });
      expect(
        await openLibrary(db, userId).captureLink({ url: target! })
      ).toMatchObject({ duplicate: true, memory: { id: row.id } });
    }
    for (const original of [canonical, collision, lookalike, short]) {
      const [kept] = await db
        .select()
        .from(schema.memory)
        .where(eq(schema.memory.id, original.id));
      expect(kept).toEqual(original);
    }
    expect(
      await openLibrary(db, another).captureLink({
        url: "https://x.com/ben/status/789",
      })
    ).toMatchObject({ duplicate: true, memory: { id: separate.id } });
    const before = await db.select().from(schema.memory);
    await apply();
    const after = await db.select().from(schema.memory);
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.sort((a, b) => a.id.localeCompare(b.id))
    );
  });

  it("rolls back every URL change if the transaction is rolled back", async () => {
    const row = await legacy(
      await owner(),
      "https://twitter.com/ana/status/999"
    );
    const client = new Client({ connectionString: testUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(migration, "utf8"));
      expect(
        (
          await client.query(
            "select source_url_normalised from memory where id = $1",
            [row.id]
          )
        ).rows[0].source_url_normalised
      ).toBe("https://x.com/ana/status/999");
      await client.query("ROLLBACK");
      expect(
        (
          await client.query(
            "select source_url_normalised from memory where id = $1",
            [row.id]
          )
        ).rows[0].source_url_normalised
      ).toBe(row.sourceUrlNormalised);
    } finally {
      await client.end();
    }
  });
});
