import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  indexingStore,
  openCategories,
  openDatabase,
  openLibrary,
  accountJobs,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";
const url = process.env.DATABASE_URL;
describe.skipIf(!url)("Bulk removal durability", () => {
  let db: Database, close: () => Promise<void>, owner: string;
  beforeAll(async () => {
    ({ db, close } = openDatabase(url!));
    owner = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, owner);
    await close();
  });
  it("removes files, copies, search and export; durable cleanup survives a storage failure", async () => {
    const library = openLibrary(db, owner);
    const saved = await library.captureImage({
      id: crypto.randomUUID(),
      mime: "image/png",
      bytes: 2048,
      width: 800,
      height: 600,
      contentHash: "ab".repeat(32),
      thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
      thumbnail: { mime: "image/webp", bytes: 300 },
    });
    if (!("memory" in saved)) throw new Error("Capture failed");
    await library.markStored(saved.memory.id);
    await library.edit(saved.memory.id, { title: "Bulk Durability" });
    const store = indexingStore(db);
    const loaded = (await store.load(saved.memory.id))!;
    const claim = { ...loaded, memoryId: saved.memory.id };
    const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const embedding = {
      model: "bulk-removal",
      dimensions: 768,
      revision: loaded.revision,
      vectors: [{ kind: "overview" as const, embedding: vector }],
    };
    await store.complete(
      claim,
      {
        model: "fixture",
        output: {
          title: "Bulk Durability",
          description: "",
          ocrText: "",
          entities: [],
          tags: [],
          language: "en",
        },
      },
      embedding
    );
    const probe = { model: embedding.model, dimensions: 768, vector };
    expect((await library.search("", { probe })).map((m) => m.id)).toContain(
      saved.memory.id
    );
    const files = (await library.files(saved.memory.id))!;
    const copyKey = `users/${owner}/memories/${saved.memory.id}/copy.webm`;
    await db.insert(schema.memoryCopy).values({
      memoryId: saved.memory.id,
      role: "video",
      key: copyKey,
      mime: "video/webm",
      bytes: 8,
      storedAt: new Date(),
    });
    expect(
      await library.bulk({ ids: [saved.memory.id], operation: "delete" })
    ).toMatchObject({ ids: [saved.memory.id] });
    expect(await library.get(saved.memory.id)).toBeUndefined();
    expect(await library.files(saved.memory.id)).toBeUndefined();
    expect(await library.search("Durability")).toEqual([]);
    expect(await library.search("", { probe })).toEqual([]);
    expect(await store.writeVectors(claim, embedding)).toBe(false);
    expect(await library.exportPage()).toEqual([]);
    const keys = [...files.map((f) => f.key), copyKey];
    // Boundary is the durable queue's drain, not private deletion helpers.
    const jobs = accountJobs(db);
    await expect(
      jobs.sweepExports(async () => {
        throw new Error("Storage unavailable");
      })
    ).rejects.toThrow("Storage unavailable");
    const removed: string[] = [];
    await jobs.sweepExports(async (batch) => {
      removed.push(...batch);
    });
    expect(removed).toEqual(expect.arrayContaining(keys));
    const again: string[] = [];
    await jobs.sweepExports(async (batch) => {
      again.push(...batch);
    });
    expect(again.some((k) => keys.includes(k))).toBe(false);
  });
  it("handles 1,001 Memories in bounded transactions", async () => {
    const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
    // Fixture bypasses Capture's daily allowance, as a pre-existing large Library.
    await db.insert(schema.memory).values(
      ids.map((id) => ({
        id,
        userId: owner,
        kind: "text" as const,
        body: "Bulk Library",
        preservation: "preserved" as const,
      }))
    );
    for (let i = 0; i < ids.length; i += 200)
      expect(await libraryBulk(ids.slice(i, i + 200))).toMatchObject({
        ids: expect.any(Array),
      });
    expect(await openLibrary(db, owner).exportPage()).toEqual([]);
  });
  it("accepts the owner's Categories and bumps their generation only on a new choice", async () => {
    const library = openLibrary(db, owner);
    const capture = async () => {
      const saved = await library.capture({ body: "Generation probe" });
      if (!("memory" in saved)) throw new Error("Capture failed");
      return saved.memory;
    };
    const generation = async () =>
      (await indexingStore(db).load((await capture()).id))!
        .categoriesGeneration;
    const chosen = await capture();
    const change = {
      ids: [chosen.id],
      operation: "categories" as const,
      categories: ["Recipe"],
    };
    expect(await generation()).toBe(0);
    await library.bulk(change);
    expect(await generation()).toBe(1);
    await library.bulk(change);
    expect(await generation()).toBe(1);
    await openCategories(db, owner).create("Gardening");
    expect(
      await library.bulk({ ...change, categories: ["Gardening"] })
    ).toEqual({ ids: [chosen.id] });
    expect(await library.get(chosen.id)).toMatchObject({
      categories: ["Gardening"],
      categoriesLocked: true,
    });
    expect(await generation()).toBe(3);
  });
  const libraryBulk = (ids: string[]) =>
    openLibrary(db, owner).bulk({ ids, operation: "delete" });
});
