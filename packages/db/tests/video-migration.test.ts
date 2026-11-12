import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;
const migration = new URL(
  "../migrations/0020_video_sources.sql",
  import.meta.url
);

describe.skipIf(!databaseUrl)("existing video Sources migration", () => {
  let db: Database;
  let close: () => Promise<void>;
  const databaseName = `video_migration_${crypto.randomUUID().replaceAll("-", "")}`;
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
  const owner = async () => {
    const id = await newUser(db);
    return id;
  };
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

  it("upgrades legacy URLs without a second Capture and fences stale Indexing", async () => {
    const userId = await owner();
    const row = await legacy(userId, "https://youtu.be/abcdefghijk?t=42", {
      indexState: "indexing",
      aiOptOut: true,
    });
    const store = indexingStore(db);
    const loaded = await store.load(row.id, 4);
    expect(loaded).toBeDefined();
    await db.insert(schema.memoryIndex).values({
      memoryId: row.id,
      title: "Old Index",
      description: "Old Description",
      ocrText: "",
      entities: [],
      tags: [],
      model: "old",
    });
    await db.insert(schema.memoryVector).values({
      memoryId: row.id,
      userId,
      kind: "overview",
      model: "old",
      dimensions: 3,
      embedding: [1, 0, 0],
    });
    await apply();
    const library = openLibrary(db, userId);
    const upgraded = await library.get(row.id);
    expect(upgraded).toMatchObject({
      id: row.id,
      kind: "video",
      sourceUrl: row.sourceUrl,
      title: "My Title",
      pageTitle: "Source Title",
      body: "Original Source text",
      captureNote: "Kept Note",
      aiOptOut: true,
      indexState: "indexing",
      preservation: "reference_only",
      indexRun: 5,
      revision: 3,
    });
    const recaptured = await library.captureLink({
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=100",
    });
    expect(recaptured).toMatchObject({
      duplicate: true,
      memory: { id: row.id, kind: "video" },
    });
    expect(
      await store.saveGathered(
        { memoryId: row.id, userId, generation: loaded!.generation, run: 4 },
        { metadata: { title: "Late" }, text: "Late text" }
      )
    ).toBeUndefined();
    const pending = await store.load(row.id, 5);
    expect(pending).toMatchObject({ gathered: false });
    expect(
      await db
        .select()
        .from(schema.memoryIndex)
        .where(eq(schema.memoryIndex.memoryId, row.id))
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.memoryVector)
        .where(eq(schema.memoryVector.memoryId, row.id))
    ).toEqual([]);
    const [before] = await db
      .select()
      .from(schema.memory)
      .where(eq(schema.memory.id, row.id));
    await apply();
    const [after] = await db
      .select()
      .from(schema.memory)
      .where(eq(schema.memory.id, row.id));
    expect(after).toEqual(before);
  }, 30_000);

  it("handles supported YouTube forms and Vimeo without changing other Sources", async () => {
    const userId = await owner();
    const cases = [
      [
        "http://m.youtube.com/watch?list=abc&t=60&v=bcdefghijkl",
        "https://www.youtube.com/watch?v=bcdefghijkl",
      ],
      [
        "https://youtube.com/shorts/cdefghijklm?feature=share",
        "https://www.youtube.com/watch?v=cdefghijklm",
      ],
      [
        "https://www.youtube.com/embed/defghijklmn?start=20",
        "https://www.youtube.com/watch?v=defghijklmn",
      ],
      [
        "https://youtube.com/live/efghijklmno",
        "https://www.youtube.com/watch?v=efghijklmno",
      ],
      [
        "https://vimeo.com/123456?autoplay=0",
        "https://vimeo.com/123456?autoplay=0",
      ],
    ];
    const rows = [];
    for (const [url, target] of cases)
      rows.push({ row: await legacy(userId, url!), target });
    const other = await legacy(
      userId,
      "https://youtube.com.evil.test/watch?v=abcdefghijk"
    );
    await apply();
    const library = openLibrary(db, userId);
    for (const { row, target } of rows) {
      expect(await library.get(row.id)).toMatchObject({
        kind: "video",
        indexRun: 5,
      });
      expect(await library.captureLink({ url: target! })).toMatchObject({
        duplicate: true,
        memory: { id: row.id },
      });
    }
    expect(await library.get(other.id)).toMatchObject({
      kind: "link",
      pageTitle: "Source Title",
      indexState: "searchable",
      indexRun: 4,
    });
  }, 30_000);

  it("skips and logs collisions without losing either Memory or crossing owners", async () => {
    const userId = await owner();
    const another = await owner();
    const canonical = "https://www.youtube.com/watch?v=abcdefghijk";
    const existing = await legacy(userId, canonical, {
      kind: "video",
      metadata: { video: { transcript: [], transcriptState: "unavailable" } },
    });
    const colliding = await legacy(userId, "https://youtu.be/abcdefghijk?t=30");
    const separate = await legacy(another, "https://youtu.be/abcdefghijk?t=60");
    const notices = await apply();
    expect(notices).toContain(
      "video URL migration: skipped 1 conflicting Memories"
    );
    expect(await openLibrary(db, userId).get(colliding.id)).toMatchObject({
      kind: "link",
      body: "Original Source text",
      pageTitle: "Source Title",
      indexRun: 4,
    });
    expect(await openLibrary(db, userId).get(existing.id)).toMatchObject({
      kind: "video",
      indexRun: 4,
    });
    expect(
      await openLibrary(db, another).captureLink({ url: canonical })
    ).toMatchObject({
      duplicate: true,
      memory: { id: separate.id, kind: "video" },
    });
    expect(await apply()).toContain(
      "video URL migration: skipped 1 conflicting Memories"
    );
  }, 30_000);
});
