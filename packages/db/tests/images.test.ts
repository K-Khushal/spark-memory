import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { FREE_ALLOWANCE, type ImageCapture } from "@spark/core";
import {
  lockOwner,
  openAccount,
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

  it("keeps the extension image Source through the shared file Capture path", async () => {
    const sourceUrl = "https://garden.test/extension-image.png";
    const memory = await stored(ana, { sourceUrl });
    expect(await library(ana).get(memory.id)).toMatchObject({ sourceUrl });
  });

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

  it("does not confirm a Memory recreated while its check was in flight", async () => {
    const owner = await newUser(db);
    const input = image();
    const first = await library(owner).captureImage(input);
    if (!("uploads" in first)) throw new Error("not created");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened!: () => void;
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const checked: string[] = [];
    const mark = library(owner).markStored(input.id, async (file) => {
      checked.push(file.key);
      opened();
      await gate;
      return "stored";
    });
    await started;
    await age(input.id);
    await sweepAbandonedUploads(db, { removeObjects: async () => {} });
    const again = await library(owner).captureImage(input);
    if (!("uploads" in again)) throw new Error("not recreated");
    release();
    expect(await mark).toBe("missing");
    const files = await library(owner).files(input.id);
    expect(files?.map((file) => file.stored)).toEqual([false, false]);
    expect(again.uploads.map((file) => file.key).sort()).not.toEqual(
      checked.sort()
    );
    await removeUser(db, owner);
  });

  it("does not confirm a file whose size changed after the check", async () => {
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened!: () => void;
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const mark = library(owner).markStored(input.id, async () => {
      opened();
      await gate;
      return "stored";
    });
    await started;
    await db.execute(
      sql`update memory_file set bytes = bytes + 1 where memory_id = ${input.id} and role = 'original'`
    );
    release();
    expect(await mark).toBe("missing");
    const files = await library(owner).files(input.id);
    expect(files?.every((file) => !file.stored)).toBe(true);
    await removeUser(db, owner);
  });

  it("lists an unfinished upload only once its PUT has expired, and only to its owner", async () => {
    const input = image();
    await library(ana).captureImage(input);
    const done = await stored(ana);
    // A presigned PUT lives about 15 minutes. Until then another tab must
    // not be offered Delete: a late PUT would leave an object with no row.
    const fresh = (await library(ana).unfinished()).map((m) => m.id);
    expect(fresh).not.toContain(input.id);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '20 minutes' where memory_id = ${input.id}`
    );
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
    const created = await library(owner).captureImage(abandoned);
    if (!("uploads" in created)) throw new Error("not created");
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
    expect(removed).toEqual(
      expect.arrayContaining(created.uploads.map((file) => file.key))
    );
    expect(await library(owner).get(abandoned.id)).toBeUndefined();
    expect(await library(owner).get(kept.id)).toBeDefined();
    expect(await library(owner).get(fresh.id)).toBeDefined();
    await removeUser(db, owner);
  });

  it("checks thirty confirms at once, before the owner lock, so the network waits do not queue", async () => {
    const owner = await newUser(db);
    const ids = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const input = image();
        const created = await library(owner).captureImage(input);
        if (!("memory" in created)) throw new Error("not created");
        return input.id;
      })
    );
    // Long enough that running the checks one by one (30 × 300 ms) stays far
    // beyond the bound even when a loaded machine slows the database work.
    const CHECK_MS = 300;
    let current = 0;
    let max = 0;
    const check = async () => {
      current += 1;
      max = Math.max(max, current);
      await new Promise((r) => setTimeout(r, CHECK_MS));
      current -= 1;
      return "stored" as const;
    };
    const started = Date.now();
    const stored = await Promise.all(
      ids.map((id) => library(owner).markStored(id, check))
    );
    // One owner's confirms used to run the check under the lock: 30 × 300 ms.
    expect(Date.now() - started).toBeLessThan((30 * CHECK_MS) / 2);
    expect(max).toBeGreaterThanOrEqual(30);
    expect(stored.every((m) => m && typeof m !== "string")).toBe(true);
    await removeUser(db, owner);
    // Sixty database round trips of setup before the timed part: give a loaded
    // machine room. The time bound above covers the timed part alone.
  }, 60_000);

  it("does not mark a Memory stored once its account is being deleted", async () => {
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await openAccount(db, owner).requestDeletion();
    expect(await library(owner).markStored(input.id)).toBeUndefined();
    const { rows } = await db.execute<{ stored_at: Date | null }>(
      sql`select stored_at from memory_file where memory_id = ${input.id}`
    );
    expect(rows.map((r) => r.stored_at)).toEqual([null, null]);
    await removeUser(db, owner);
  });

  it("sweeps a later owner when earlier owners' storage deletes keep failing", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const failing = "00000000-0000-4000-8000-000000000001";
    const healthy = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await db.execute(
      sql`delete from "user" where id in (${failing}, ${healthy})`
    );
    await db.execute(sql`
      insert into "user" (id, name, email) values
        (${failing}, '', ${`sweep-${failing}@example.com`}),
        (${healthy}, '', ${`sweep-${healthy}@example.com`})
    `);
    const left = image();
    const gone = image();
    await library(failing).captureImage(left);
    await library(healthy).captureImage(gone);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${left.id}, ${gone.id})`
    );
    const swept = await sweepAbandonedUploads(db, {
      owners: 1,
      removeObjects: async (prefixes) => {
        if (prefixes.some((prefix) => prefix.startsWith(`users/${failing}/`))) {
          throw new Error("storage down");
        }
      },
    });
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await library(failing).get(left.id)).toBeDefined();
    expect(await library(healthy).get(gone.id)).toBeUndefined();
    await removeUser(db, failing);
    await removeUser(db, healthy);
  });

  it("keeps one owner's rows when their storage delete fails, and still sweeps the next", async () => {
    const broken = await newUser(db);
    const fine = await newUser(db);
    const left = image();
    const gone = image();
    await library(broken).captureImage(left);
    await library(fine).captureImage(gone);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${left.id}, ${gone.id})`
    );
    const swept = await sweepAbandonedUploads(db, {
      removeObjects: async (keys) => {
        if (keys.some((key) => key.includes(`/${broken}/`))) {
          throw new Error("storage down");
        }
      },
    });
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await library(broken).get(left.id)).toBeDefined();
    expect(await library(fine).get(gone.id)).toBeUndefined();
    await removeUser(db, broken);
    await removeUser(db, fine);
  });

  it("deletes a capped batch of Memories per transaction, then the rest", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const input = image();
      await library(owner).captureImage(input);
      ids.push(input.id);
    }
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
    const batches: number[] = [];
    const swept = await sweepAbandonedUploads(db, {
      keysPerDelete: 4,
      removeObjects: async (keys) => {
        expect(keys.length).toBeLessThanOrEqual(4);
        batches.push(new Set(keys.map((key) => key.split("/")[2])).size);
      },
    });
    expect(swept).toBe(5);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((count) => count <= 2)).toBe(true);
    for (const id of ids) expect(await library(owner).get(id)).toBeUndefined();
    await removeUser(db, owner);
  });

  it("stops at its time budget and leaves the rest for the next sweep", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const input = image();
      await library(owner).captureImage(input);
      ids.push(input.id);
    }
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
    let calls = 0;
    const swept = await sweepAbandonedUploads(db, {
      deadline: 0,
      removeObjects: async () => {
        calls += 1;
      },
    });
    expect(calls).toBe(0);
    expect(swept).toBe(0);
    const left = (
      await Promise.all(ids.map((id) => library(owner).get(id)))
    ).filter(Boolean);
    expect(left).toHaveLength(3);
    await removeUser(db, owner);
  });

  it("keeps the rows when storage deletion exceeds the time left", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await age(input.id);
    let started = false;
    const swept = await sweepAbandonedUploads(db, {
      deadline: Date.now() + 200,
      removeObjects: () => {
        started = true;
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      },
    });
    expect(started).toBe(true);
    expect(swept).toBe(0);
    expect(await library(owner).get(input.id)).toBeDefined();
    await removeUser(db, owner);
  });

  it("does not wait out the budget on an owner whose lock is held", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const busy = "00000000-0000-4000-8000-0000000000aa";
    const free = "ffffffff-ffff-4fff-8fff-ffffffffffaa";
    await db.execute(sql`delete from "user" where id in (${busy}, ${free})`);
    await db.execute(sql`
      insert into "user" (id, name, email) values
        (${busy}, '', ${`lock-${busy}@example.com`}),
        (${free}, '', ${`lock-${free}@example.com`})
    `);
    const kept = image();
    const gone = image();
    await library(busy).captureImage(kept);
    await library(free).captureImage(gone);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${kept.id}, ${gone.id})`
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const lock = db.transaction(async (tx) => {
      await lockOwner(tx, busy);
      holding();
      await gate;
    });
    await held;
    const sweep = sweepAbandonedUploads(db, {
      owners: 1,
      removeObjects: async () => {},
    });
    const outcome = await Promise.race([
      sweep.then((swept) => swept),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("blocked"), 1_000)
      ),
    ]);
    release();
    await lock;
    await sweep;
    expect(outcome).not.toBe("blocked");
    expect(await library(busy).get(kept.id)).toBeDefined();
    expect(await library(free).get(gone.id)).toBeUndefined();
    await removeUser(db, busy);
    await removeUser(db, free);
  });

  it("does not let a timed-out delete remove a generation confirmed after the lock", async () => {
    const owner = await newUser(db);
    const input = image();
    const created = await library(owner).captureImage(input);
    if (!("uploads" in created)) throw new Error("not created");
    const abandoned = created.uploads.map((file) => file.key);
    await age(input.id);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened!: () => void;
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const handed: string[] = [];
    let signal: AbortSignal | undefined;
    const sweep = sweepAbandonedUploads(db, {
      deadline: Date.now() + 400,
      removeObjects: (keys, abort) => {
        handed.push(...keys);
        signal = abort;
        opened();
        return gate;
      },
    });
    try {
      await started;
      await sweep;
      const again = await library(owner).captureImage(input);
      if (!("uploads" in again)) throw new Error("not recreated");
      const stored = await library(owner).markStored(input.id);
      expect(stored).toMatchObject({ id: input.id });
      const live = new Set(again.uploads.map((file) => file.key));
      expect(signal?.aborted).toBe(true);
      expect(handed.length).toBeGreaterThan(0);
      expect(handed.every((key) => !key.endsWith("/"))).toBe(true);
      expect(handed.every((key) => !live.has(key))).toBe(true);
      expect(handed).toEqual(expect.arrayContaining(abandoned));
      const files = await library(owner).files(input.id);
      expect(files?.every((file) => file.stored)).toBe(true);
    } finally {
      release();
    }
    await removeUser(db, owner);
  });

  it("deletes replaced keys with the abandoned upload, and not before the PUT expires", async () => {
    const owner = await newUser(db);
    const input = image();
    const first = await library(owner).captureImage(input);
    if (!("uploads" in first)) throw new Error("not created");
    const again = await library(owner).captureImage(input);
    if (!("uploads" in again)) throw new Error("not retried");
    const { rows } = await db.execute<{ later: boolean }>(sql`
      select due_at > now() + interval '14 minutes' as later
      from object_removal
      where key in (${sql.join(
        first.uploads.map((file) => sql`${file.key}`),
        sql`, `
      )})
    `);
    expect(rows).toHaveLength(first.uploads.length);
    expect(rows.every((row) => row.later)).toBe(true);
    await age(input.id);
    const removed: string[] = [];
    await sweepAbandonedUploads(db, {
      removeObjects: async (keys) => void removed.push(...keys),
    });
    expect(removed).toEqual(
      expect.arrayContaining([
        ...first.uploads.map((file) => file.key),
        ...again.uploads.map((file) => file.key),
      ])
    );
    expect(await library(owner).get(input.id)).toBeUndefined();
    await removeUser(db, owner);
  });

  it("sweeps healthy owners within a few runs while others keep failing", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const failing = "ffffffff-ffff-4fff-8fff-ffffffffff51";
    const healthy = "00000000-0000-4000-8000-000000000051";
    await db.execute(
      sql`delete from "user" where id in (${failing}, ${healthy})`
    );
    await db.execute(sql`
      insert into "user" (id, name, email) values
        (${failing}, '', ${`fail-${failing}@example.com`}),
        (${healthy}, '', ${`ok-${healthy}@example.com`})
    `);
    const stalled = image();
    const pending = image();
    await library(failing).captureImage(stalled);
    await library(healthy).captureImage(pending);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${stalled.id}, ${pending.id})`
    );
    const firstOwner = async (seed: number) => {
      const { rows } = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select setseed(cast(${seed} as double precision))`
        );
        return tx.execute<{ user_id: string }>(sql`
          select user_id from (
            select distinct m.user_id
            from memory_file f
            inner join memory m on m.id = f.memory_id
            where f.stored_at is null
              and f.created_at <= now() - interval '24 hours'
          ) due_owner
          order by random()
          limit 1
        `);
      });
      return rows[0]?.user_id;
    };
    let failingSeed: number | undefined;
    let healthySeed: number | undefined;
    for (
      let i = 1;
      i <= 40 && (failingSeed === undefined || healthySeed === undefined);
      i++
    ) {
      const seed = i / 40;
      const first = await firstOwner(seed);
      if (first === failing && failingSeed === undefined) failingSeed = seed;
      if (first === healthy && healthySeed === undefined) healthySeed = seed;
    }
    if (failingSeed === undefined || healthySeed === undefined) {
      throw new Error("no seeded order");
    }
    const slowFailing = (keys: string[], abort?: AbortSignal) => {
      if (!keys.some((key) => key.includes(`/${failing}/`))) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        abort?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    };
    await sweepAbandonedUploads(db, {
      owners: 1,
      orderSeed: failingSeed,
      deadline: Date.now() + 300,
      removeObjects: slowFailing,
    });
    expect(await library(healthy).get(pending.id)).toBeDefined();
    expect(await library(failing).get(stalled.id)).toBeDefined();
    await sweepAbandonedUploads(db, {
      owners: 1,
      orderSeed: healthySeed,
      removeObjects: async (keys) => {
        if (keys.some((key) => key.includes(`/${failing}/`))) {
          throw new Error("storage down");
        }
      },
    });
    expect(await library(healthy).get(pending.id)).toBeUndefined();
    expect(await library(failing).get(stalled.id)).toBeDefined();
    await removeUser(db, failing);
    await removeUser(db, healthy);
  });

  it("returns within a small bound on a 10 ms deadline, even when a statement would wait", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const lock = db.transaction(async (tx) => {
      await tx.execute(sql`lock table app_setting in access exclusive mode`);
      holding();
      await gate;
    });
    await held;
    const started = Date.now();
    const sweep = sweepAbandonedUploads(db, {
      deadline: started + 10,
      removeObjects: () => new Promise(() => {}),
    });
    const outcome = await Promise.race([
      sweep.then(() => "done" as const),
      new Promise<"slow">((resolve) =>
        setTimeout(() => resolve("slow"), 1_000)
      ),
    ]);
    release();
    await lock;
    await sweep;
    expect(outcome).toBe("done");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("stops storage deletes once its share of calls is spent", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const input = image();
      await library(owner).captureImage(input);
      ids.push(input.id);
    }
    await db.execute(
      sql`update memory_file set created_at = now() - interval '2 days' where memory_id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
    let left = 1;
    let calls = 0;
    const swept = await sweepAbandonedUploads(db, {
      keysPerDelete: 2,
      allowCall: () => {
        if (left <= 0) return false;
        left -= 1;
        return true;
      },
      removeObjects: async () => {
        calls += 1;
      },
    });
    expect(calls).toBe(1);
    expect(swept).toBe(1);
    const staying = (
      await Promise.all(ids.map((id) => library(owner).get(id)))
    ).filter(Boolean);
    expect(staying).toHaveLength(3);
    await removeUser(db, owner);
  });

  it("stops the next statement when the time left is gone, and keeps the rows", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await age(input.id);
    const { rows } = await db.execute<{ key: string }>(
      sql`select r2_key as key from memory_file where memory_id = ${input.id} limit 1`
    );
    const fileKey = rows[0]!.key;
    await db.execute(
      sql`insert into object_removal (key) values (${fileKey}) on conflict do nothing`
    );
    let releaseRemoval!: () => void;
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let releaseMemory!: () => void;
    const memoryGate = new Promise<void>((resolve) => {
      releaseMemory = resolve;
    });
    let removalLocked!: () => void;
    const removalHeld = new Promise<void>((resolve) => {
      removalLocked = resolve;
    });
    let memoryLocked!: () => void;
    const memoryHeld = new Promise<void>((resolve) => {
      memoryLocked = resolve;
    });
    let locksHeld!: () => void;
    const locks = new Promise<void>((resolve) => {
      locksHeld = resolve;
    });
    const lockRemoval = db.transaction(async (tx) => {
      await tx.execute(
        sql`select key from object_removal where key = ${fileKey} for update`
      );
      removalLocked();
      await removalGate;
    });
    const lockMemory = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from memory where id = ${input.id} for update`
      );
      memoryLocked();
      await memoryGate;
    });
    const sweep = sweepAbandonedUploads(db, {
      deadline: Date.now() + 3_000,
      removeObjects: async () => {
        await Promise.all([removalHeld, memoryHeld]);
        locksHeld();
      },
    });
    const outcome = Promise.race([
      sweep.then(() => "done" as const),
      locks.then(
        () =>
          new Promise<"slow">((resolve) =>
            setTimeout(() => resolve("slow"), 3_600)
          )
      ),
    ]);
    try {
      await locks;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      releaseRemoval();
      await lockRemoval;
      expect(await outcome).toBe("done");
      expect(await library(owner).get(input.id)).toBeDefined();
    } finally {
      releaseRemoval();
      releaseMemory();
      await lockRemoval.catch(() => {});
      await lockMemory.catch(() => {});
      await sweep.catch(() => {});
      await db.execute(sql`delete from object_removal where key = ${fileKey}`);
      await removeUser(db, owner);
    }
  });

  it("releases the connection when the deadline passes during checkout", async () => {
    await db.execute(sql`
      delete from memory where id in (
        select memory_id from memory_file
        where stored_at is null
          and created_at <= now() - interval '24 hours')`);
    const owner = await newUser(db);
    const input = image();
    await library(owner).captureImage(input);
    await age(input.id);
    const pool = db.$client;
    const connect = pool.connect.bind(pool);
    let checkouts = 0;
    pool.connect = (async () => {
      checkouts += 1;
      const client = await connect();
      if (checkouts === 2) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      return client;
    }) as typeof pool.connect;
    let calls = 0;
    const held: PoolClient[] = [];
    try {
      await sweepAbandonedUploads(db, {
        deadline: Date.now() + 400,
        removeObjects: async () => {
          calls += 1;
        },
      });
    } finally {
      // Drizzle's later queries use the callback form. Put the real one back
      // before anything else borrows a connection.
      pool.connect = connect as typeof pool.connect;
    }
    expect(calls).toBe(0);
    expect(await library(owner).get(input.id)).toBeDefined();
    const outcome = await Promise.race([
      (async () => {
        for (let i = 0; i < 5; i++)
          held.push((await pool.connect()) as PoolClient);
        return "free" as const;
      })(),
      new Promise<"held">((resolve) =>
        setTimeout(() => resolve("held"), 1_000)
      ),
    ]);
    for (const client of held) client.release();
    expect(outcome).toBe("free");
    await removeUser(db, owner);
  });
});
