import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { FREE_ALLOWANCE, type ImageCapture } from "@spark/core";
import {
  openDatabase,
  openLibrary,
  sweepAbandonedUploads,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Image Memories against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

const MB = 1024 * 1024;

const image = (over: Partial<ImageCapture> = {}): ImageCapture => ({
  id: crypto.randomUUID(),
  mime: "image/png",
  bytes: 2048,
  width: 800,
  height: 600,
  contentHash: "ab".repeat(32),
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: 300 },
  ...over,
});

describe.skipIf(!databaseUrl)("image Memories", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ana = await newUser(db);
    ben = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, ana);
    await removeUser(db, ben);
    await close();
  });

  const library = (userId: string) => openLibrary(db, userId);

  /** Captures an image and marks its files stored, as after an upload. */
  async function stored(userId: string, over: Partial<ImageCapture> = {}) {
    const result = await library(userId).captureImage(image(over));
    if (!("memory" in result)) throw new Error("not created");
    const memory = await library(userId).markStored(result.memory.id);
    if (!memory || typeof memory === "string") throw new Error("not stored");
    return memory;
  }

  const age = (id: string) =>
    db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id = ${id}`
    );

  it("never stores an upload that outlived its window, until a retry starts a new one", async () => {
    const input = image();
    await library(ana).captureImage(input);
    await age(input.id);
    expect(await library(ana).markStored(input.id)).toBe("expired");
    await library(ana).captureImage(input);
    expect(await library(ana).markStored(input.id)).toMatchObject({
      id: input.id,
    });
  });

  it("never stores a Memory the sweep is taking: a late confirm waits, then finds it gone", async () => {
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await age(input.id);
    let late: Promise<unknown> | undefined;
    await sweepAbandonedUploads(db, {
      // The confirm arrives while the sweep is deleting the objects.
      removeObjects: async () => {
        late = library(owner).markStored(input.id);
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    expect(await late).toBeUndefined();
    expect(await library(owner).get(input.id)).toBeUndefined();
    await removeUser(db, owner);
  });

  it("lists its owner's unfinished uploads apart from the wall, and no one else's", async () => {
    const input = image();
    await library(ana).captureImage(input);
    const done = await stored(ana);
    const ids = (await library(ana).unfinished()).map((m) => m.id);
    expect(ids).toContain(input.id);
    expect(ids).not.toContain(done.id);
    expect((await library(ben).unfinished()).map((m) => m.id)).not.toContain(
      input.id
    );
  });

  it("stores nothing that storage does not confirm", async () => {
    const input = image();
    await library(ana).captureImage(input);
    const checked: string[] = [];
    const missing = async (f: { role: string }) => {
      checked.push(f.role);
      return "missing" as const;
    };
    expect(await library(ana).markStored(input.id, missing)).toBe("missing");
    expect(checked.sort()).toEqual(["original", "thumbnail"]);
    expect(
      (await library(ana).list({ limit: 500 }))!.memories.map((m) => m.id)
    ).not.toContain(input.id);
  });

  it("turns a Try Again during the sweep into a fresh Memory, so its files are sent again", async () => {
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await age(input.id);
    let retry: Promise<unknown> | undefined;
    await sweepAbandonedUploads(db, {
      removeObjects: async () => {
        retry = library(owner).captureImage(input);
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    expect(await retry).toMatchObject({
      created: true,
      uploads: [{ role: "original" }, { role: "thumbnail" }],
    });
    await removeUser(db, owner);
  });

  it("re-checks storage when an expired upload is retried, so retries cannot overfill it", async () => {
    const owner = await newUser(db);
    const big = { bytes: FREE_ALLOWANCE.maxUploadBytes };
    const expired = image(big);
    await library(owner).captureImage(expired);
    await age(expired.id);
    // The expired upload no longer counts, so storage fills up without it.
    for (let i = 0; i < 40; i++) await stored(owner, big);
    expect(await library(owner).captureImage(expired)).toEqual({
      refused: "storage_full",
    });
    expect(await library(owner).usedStorage()).toBeLessThanOrEqual(
      FREE_ALLOWANCE.storageBytes
    );
    await removeUser(db, owner);
  });

  it("creates the Memory first, with uploads for its original and thumbnail under the owner's keys", async () => {
    const input = image();
    const result = await library(ana).captureImage(input);
    expect(result).toMatchObject({
      created: true,
      memory: {
        id: input.id,
        kind: "image",
        preservation: "preserved",
        indexState: "indexing",
        image: { mime: "image/png", width: 800, height: 600 },
      },
      uploads: [
        { role: "original", mime: "image/png", bytes: 2048 },
        { role: "thumbnail", mime: "image/webp", bytes: 300 },
      ],
    });
    if (!("uploads" in result)) throw new Error("no uploads");
    for (const upload of result.uploads) {
      expect(upload.key.startsWith(`users/${ana}/${input.id}/`)).toBe(true);
    }
  });

  it("keeps an image off the wall until its files are stored", async () => {
    const input = image();
    await library(ana).captureImage(input);
    const ids = async () =>
      (await library(ana).list({ limit: 500 }))!.memories.map((m) => m.id);
    expect(await ids()).not.toContain(input.id);
    await library(ana).markStored(input.id);
    expect(await ids()).toContain(input.id);
  });

  it("answers a retry with the same Memory and only the uploads still missing", async () => {
    const input = image();
    await library(ana).captureImage(input);
    const retry = await library(ana).captureImage(input);
    expect(retry).toMatchObject({ created: false, uploads: [{}, {}] });
    await library(ana).markStored(input.id);
    expect(await library(ana).captureImage(input)).toMatchObject({
      created: false,
      uploads: [],
    });
  });

  it("stores the content hash", async () => {
    const memory = await stored(ana, { contentHash: "cd".repeat(32) });
    const { rows } = await db.execute<{ content_hash: string }>(
      sql`select content_hash from memory where id = ${memory.id}`
    );
    expect(rows[0]?.content_hash).toBe("cd".repeat(32));
  });

  it("refuses an image beyond the storage in the Free allowance", async () => {
    const owner = await newUser(db);
    // 41 full-size images fill 1 GB (25 MB each, 1,025 MB with thumbnails).
    const big = { bytes: FREE_ALLOWANCE.maxUploadBytes };
    for (let i = 0; i < 40; i++) await stored(owner, big);
    expect(await library(owner).usedStorage()).toBeGreaterThan(1000 * MB);
    expect(await library(owner).captureImage(image(big))).toEqual({
      refused: "storage_full",
    });
    await removeUser(db, owner);
  });

  it("counts uploads still in progress, so parallel Captures cannot overfill storage", async () => {
    const owner = await newUser(db);
    const big = { bytes: FREE_ALLOWANCE.maxUploadBytes };
    const results = await Promise.all(
      Array.from({ length: 45 }, () => library(owner).captureImage(image(big)))
    );
    const refused = results.filter((r) => "refused" in r);
    expect(results.length - refused.length).toBe(40);
    await removeUser(db, owner);
  });

  it("never shows, stores or takes another person's image", async () => {
    const memory = await stored(ana);
    expect(await library(ben).get(memory.id)).toBeUndefined();
    expect(await library(ben).files(memory.id)).toBeUndefined();
    expect(await library(ben).markStored(memory.id)).toBeUndefined();
    expect(await library(ben).captureImage(image({ id: memory.id }))).toEqual({
      conflict: true,
    });
    expect(await library(ana).get(memory.id)).toBeDefined();
  });

  it("refuses a text edit of an image Memory", async () => {
    const memory = await stored(ana);
    expect(
      await library(ana).edit(memory.id, { body: "text" })
    ).toBeUndefined();
  });

  it("lists a Memory's files with their keys, for checking and deleting them", async () => {
    const memory = await stored(ana);
    const files = await library(ana).files(memory.id);
    expect(files?.map((f) => [f.role, f.stored])).toEqual([
      ["original", true],
      ["thumbnail", true],
    ]);
  });

  it("sweeps images whose upload never finished, objects first", async () => {
    const owner = await newUser(db);
    const abandoned = image();
    await library(owner).captureImage(abandoned);
    const kept = await stored(owner);
    const fresh = image();
    await library(owner).captureImage(fresh);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${abandoned.id}, ${kept.id})`
    );

    const removed: string[] = [];
    const swept = await sweepAbandonedUploads(db, {
      removeObjects: async (keys) => void removed.push(...keys),
    });
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(removed).toContain(`users/${owner}/${abandoned.id}/original`);
    expect(removed).toContain(`users/${owner}/${abandoned.id}/thumbnail`);
    expect(await library(owner).get(abandoned.id)).toBeUndefined();
    expect(await library(owner).get(kept.id)).toBeDefined();
    expect(await library(owner).get(fresh.id)).toBeDefined();
    await removeUser(db, owner);
  });

  it("keeps the rows when deleting the objects fails, to try again next time", async () => {
    const owner = await newUser(db);
    const abandoned = image();
    await library(owner).captureImage(abandoned);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id = ${abandoned.id}`
    );
    await expect(
      sweepAbandonedUploads(db, {
        removeObjects: () => Promise.reject(new Error("storage down")),
      })
    ).rejects.toThrow();
    expect(await library(owner).get(abandoned.id)).toBeDefined();
    await removeUser(db, owner);
  });
});
