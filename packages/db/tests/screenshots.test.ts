import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  accountJobs,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("screenshot cleanup", () => {
  let db: Database;
  let close: () => Promise<void>;
  let owner: string;
  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    owner = await newUser(db);
  });
  afterAll(async () => {
    await db
      .delete(schema.objectRemoval)
      .where(
        sql`starts_with(${schema.objectRemoval.key}, ${`users/${owner}/`})`
      );
    await removeUser(db, owner);
    await close();
  });
  const library = () => openLibrary(db, owner);
  const prepare = async () => {
    const result = await library().captureLink({
      url: `https://garden.test/${crypto.randomUUID()}`,
    });
    if (!("memory" in result)) throw new Error("conflict");
    const slot = await library().prepareScreenshot(result.memory.id, 4);
    if (!slot || !("key" in slot)) throw new Error("no screenshot slot");
    return { id: result.memory.id, key: slot.key };
  };
  const expire = async (key: string) =>
    db
      .update(schema.objectRemoval)
      .set({ dueAt: sql`now() - interval '1 second'` })
      .where(eq(schema.objectRemoval.key, key));
  const removals = async () => {
    const keys: string[] = [];
    await accountJobs(db).sweepExports(async (batch) => {
      keys.push(...batch);
    });
    return keys;
  };

  it("clears cleanup only after a screenshot is recorded and refuses expired slots", async () => {
    const { id, key } = await prepare();
    expect(await library().recordScreenshot(id, { key, bytes: 4 })).toBe(true);
    await expire(key);
    expect(await removals()).not.toContain(key);
    const late = await prepare();
    await expire(late.key);
    expect(
      await library().recordScreenshot(late.id, { key: late.key, bytes: 4 })
    ).toBe(false);
  });

  it("queues a screenshot recorded after a deletion's file snapshot", async () => {
    const { id, key } = await prepare();
    expect(await library().files(id)).toEqual([]);
    expect(await library().recordScreenshot(id, { key, bytes: 4 })).toBe(true);
    expect(await library().remove(id)).toBe(true);
    expect(await removals()).toContain(key);
  });

  it("serializes permanent deletion with concurrent screenshot recording", async () => {
    for (let n = 0; n < 12; n++) {
      const { id, key } = await prepare();
      const [recorded, removed] = await Promise.all([
        library().recordScreenshot(id, { key, bytes: 4 }),
        library().remove(id),
      ]);
      expect(removed).toBe(true);
      expect(await library().get(id)).toBeUndefined();
      // Both orderings retain cleanup: a committed file is queued by
      // deletion; an upload refused after deletion keeps its pending key.
      if (!recorded) await expire(key);
      expect(await removals()).toContain(key);
    }
  }, 30_000);

  it("does not sweep a key being consumed by an in-flight recording transaction", async () => {
    const { key } = await prepare();
    await expire(key);
    let release!: () => void;
    let consumed!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      consumed = resolve;
    });
    const recording = db.transaction(async (tx) => {
      await tx
        .delete(schema.objectRemoval)
        .where(eq(schema.objectRemoval.key, key));
      consumed();
      await hold;
    });
    await ready;
    const sweep = removals();
    try {
      // Keep the consuming transaction open while the sweep reaches its query.
      await db.execute(sql`select pg_sleep(1)`);
    } finally {
      release();
    }
    await recording;
    expect(await sweep).not.toContain(key);
  }, 30_000);

  it("tracks an abandoned screenshot before uploading without hiding the link", async () => {
    const { id, key } = await prepare();
    expect(await library().get(id)).toMatchObject({ id });
    expect(await removals()).not.toContain(key);
    await expire(key);
    expect(await removals()).toContain(key);
    expect(await library().get(id)).toMatchObject({ id });
  });
});
