import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { FREE_ALLOWANCE } from "@spark/core";
import {
  openDatabase,
  openImports,
  pendingImports,
  openLibrary,
  type Database,
} from "../index";
import { newUser } from "./users";
let db: Database, close: () => Promise<void>, owner: string;
beforeAll(async () => {
  ({ db, close } = openDatabase(process.env.DATABASE_URL!));
  owner = await newUser(db);
});
afterAll(async () => {
  if (owner) await db.execute(sql`delete from "user" where id = ${owner}`);
  await close?.();
});
it.skipIf(!process.env.DATABASE_URL)(
  "persists progress, skips canonical duplicates and serializes concurrent deliveries",
  async () => {
    const jobs = openImports(db, owner);
    const id = crypto.randomUUID();
    await openLibrary(db, owner).captureLink({ url: "https://food.test/tea" });
    await jobs.create({ id, total: 2, spread: true });
    await jobs.append(id, {
      offset: 0,
      items: [
        { url: "https://food.test/tea?utm_source=pocket" },
        {
          url: "https://food.test/toast",
          title: "Toast",
          savedAt: "2021-01-01T00:00:00.000Z",
        },
      ],
    });
    await jobs.action(id, "start");
    await Promise.all([jobs.step(id), jobs.step(id), jobs.step(id)]);
    expect(await jobs.get(id)).toMatchObject({ done: 0, skipped: 1 });
    await jobs.step(
      id,
      new Date(),
      (await jobs.get(id))!.availableAt.toISOString()
    );
    expect(await jobs.get(id)).toMatchObject({
      state: "done",
      done: 1,
      skipped: 1,
      total: 2,
    });
    expect(await openImports(db, "someone-else").get(id)).toBeUndefined();
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "pause, resume and cancel preserve committed progress and fence stale deliveries",
  async () => {
    const jobs = openImports(db, owner),
      id = crypto.randomUUID();
    await jobs.create({ id, total: 2, spread: true });
    const batch = {
      offset: 0,
      items: [
        { url: "https://pause.test/one" },
        { url: "https://pause.test/two" },
      ],
    };
    expect(await jobs.append(id, batch)).toBe(true);
    expect(await jobs.append(id, batch)).toBe(true);
    expect(
      await jobs.append(id, {
        ...batch,
        items: [{ url: "https://tampered.test/" }],
      })
    ).toBe(false);
    await jobs.action(id, "start");
    await jobs.step(id);
    await jobs.action(id, "pause");
    await jobs.step(id);
    expect(await jobs.get(id)).toMatchObject({ state: "paused", done: 1 });
    await jobs.action(id, "resume");
    await jobs.action(id, "cancel");
    await jobs.step(id);
    expect(await jobs.get(id)).toMatchObject({ state: "cancelled", done: 1 });
    expect(await jobs.action(id, "resume")).toBe(false);
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "defers to the next UTC day by default; Import All Today keeps excess links Reference Only",
  async () => {
    await db.execute(
      sql`insert into usage_day (user_id, day, captures) values (${owner}, (now() at time zone 'utc')::date, 100) on conflict (user_id, day) do update set captures = 100`
    );
    const jobs = openImports(db, owner),
      id = crypto.randomUUID();
    await jobs.create({ id, total: 1, spread: true });
    await jobs.append(id, {
      offset: 0,
      items: [{ url: "https://allowance.test/wait" }],
    });
    await jobs.action(id, "start");
    const now = new Date();
    expect(await jobs.step(id, now)).toMatchObject({
      dueAt: expect.any(String),
    });
    expect(await jobs.get(id)).toMatchObject({ state: "running", done: 0 });
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    expect((await jobs.get(id))?.availableAt).toEqual(tomorrow);
    await jobs.action(id, "cancel");
    const all = crypto.randomUUID();
    await jobs.create({ id: all, total: 1, spread: false });
    await jobs.append(all, {
      offset: 0,
      items: [
        {
          url: "https://allowance.test/all",
          title: "Tea",
          savedAt: "2021-01-01T00:00:00.000Z",
        },
      ],
    });
    await jobs.action(all, "start");
    expect(await jobs.step(all)).toBeUndefined();
    expect(await jobs.get(all)).toMatchObject({ state: "done", done: 1 });
    const page = await openLibrary(db, owner).list();
    const kept = page?.memories.find(
      (m) => m.sourceUrl === "https://allowance.test/all"
    );
    expect(kept).toMatchObject({
      preservation: "reference_only",
      indexState: "searchable",
      title: "Tea",
      capturedAt: new Date("2021-01-01T00:00:00.000Z"),
    });
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "keeps an all-at-once import's links past the allowance only up to the daily keeps, then waits for tomorrow",
  async () => {
    const jobs = openImports(db, owner),
      id = crypto.randomUUID();
    // Today's Captures are used and one keep is left.
    await db.execute(
      sql`insert into usage_day (user_id, day, captures, kept)
          values (${owner}, (now() at time zone 'utc')::date, ${FREE_ALLOWANCE.capturesPerDay}, ${FREE_ALLOWANCE.keptPerDay - 1})
          on conflict (user_id, day) do update set captures = excluded.captures, kept = excluded.kept`
    );
    await jobs.create({ id, total: 2, spread: false });
    await jobs.append(id, {
      offset: 0,
      items: [
        { url: "https://allowance.test/keep-1" },
        { url: "https://allowance.test/keep-2" },
      ],
    });
    await jobs.action(id, "start");
    const now = new Date();
    // The first takes the last keep. The second waits for the next UTC day.
    await jobs.step(id, now);
    const waiting = await jobs.step(id, new Date(now.getTime() + 61_000));
    expect(waiting).toMatchObject({ dueAt: expect.any(String) });
    expect(await jobs.get(id)).toMatchObject({ state: "running", done: 1 });
    const urls = (await openLibrary(db, owner).list())!.memories.map(
      (m) => m.sourceUrl
    );
    expect(urls).toContain("https://allowance.test/keep-1");
    expect(urls).not.toContain("https://allowance.test/keep-2");
    await jobs.action(id, "cancel");
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "image jobs observe existing image Capture exactly once and keep its background priority",
  async () => {
    const jobs = openImports(db, owner),
      id = crypto.randomUUID(),
      imageId = crypto.randomUUID();
    // A new UTC day makes room after the preceding allowance boundary case.
    await db.execute(
      sql`update usage_day set captures = 0 where user_id = ${owner}`
    );
    await jobs.create({ id, total: 1, spread: true });
    await jobs.append(id, { offset: 0, items: [{ imageId }] });
    await jobs.action(id, "start");
    expect(await jobs.pendingImages(id)).toEqual([imageId]);
    await jobs.step(id);
    expect(await jobs.get(id)).toMatchObject({ done: 0 });
    const library = openLibrary(db, owner);
    await jobs.action(id, "pause");
    expect(
      await library.captureImage({
        id: imageId,
        importJobId: id,
        mime: "image/png",
        bytes: 2048,
        width: 800,
        height: 600,
        contentHash: "ab".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 300 },
      })
    ).toEqual({ conflict: true });
    await jobs.action(id, "resume");
    const result = await library.captureImage({
      id: imageId,
      background: true,
      importJobId: id,
      mime: "image/png",
      bytes: 2048,
      width: 800,
      height: 600,
      contentHash: "ab".repeat(32),
      thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
      thumbnail: { mime: "image/webp", bytes: 300 },
    });
    expect(result).toMatchObject({ memory: { indexPriority: "background" } });
    await library.markStored(imageId);
    expect(await jobs.pendingImages(id)).toEqual([]);
    await Promise.all([jobs.step(id), jobs.step(id)]);
    expect(await jobs.get(id)).toMatchObject({ state: "done", done: 1 });
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "leases an active chain and lets the sweep recover only a stale lease",
  async () => {
    const jobs = openImports(db, owner),
      id = crypto.randomUUID();
    await jobs.create({ id, total: 3, spread: true });
    await jobs.append(id, {
      offset: 0,
      items: [
        { url: "https://lease.test/1" },
        { url: "https://lease.test/2" },
        { url: "https://lease.test/3" },
      ],
    });
    await jobs.action(id, "start");
    const now = new Date();
    await jobs.step(id, now);
    const lease = (await jobs.get(id))!.availableAt;
    expect(lease.getTime()).toBeGreaterThanOrEqual(now.getTime() + 60_000);
    expect(await pendingImports(db, 100, now)).not.toContainEqual({
      id,
      userId: owner,
    });
    await jobs.step(id, new Date(now.getTime() + 30_000), lease.toISOString());
    expect(await jobs.get(id)).toMatchObject({ done: 2 });
    expect(
      await pendingImports(db, 100, new Date(now.getTime() + 5 * 60_000))
    ).not.toContainEqual({ id, userId: owner });
    expect(
      await pendingImports(db, 100, new Date(now.getTime() + 12 * 60_000))
    ).toContainEqual({ id, userId: owner });
    await jobs.action(id, "cancel");
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "reserves half the daily Captures for fresh saves, including image imports",
  async () => {
    const userId = await newUser(db);
    try {
      const jobs = openImports(db, userId),
        library = openLibrary(db, userId),
        id = crypto.randomUUID();
      await jobs.create({ id, total: 51, spread: true });
      await jobs.append(id, {
        offset: 0,
        items: Array.from({ length: 51 }, (_, i) => ({
          url: `https://reserve.test/${i}`,
        })),
      });
      await jobs.action(id, "start");
      let lease: string | undefined;
      for (let i = 0; i < 51; i++)
        lease = (await jobs.step(id, new Date(), lease))?.lease;
      expect(await jobs.get(id)).toMatchObject({ done: 50, state: "running" });
      expect((await library.usage()).captures).toBe(50);
      await jobs.action(id, "cancel");
      const images = crypto.randomUUID(),
        imageId = crypto.randomUUID();
      await jobs.create({ id: images, total: 1, spread: true });
      await jobs.append(images, { offset: 0, items: [{ imageId }] });
      await jobs.action(images, "start");
      expect(await jobs.pendingImages(images)).toEqual([]);
      expect(
        await library.captureImage({
          id: imageId,
          importJobId: images,
          mime: "image/png",
          bytes: 2048,
          width: 800,
          height: 600,
          contentHash: "ab".repeat(32),
          thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
          thumbnail: { mime: "image/webp", bytes: 300 },
        })
      ).toEqual({ refused: "captures_full" });
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          library.capture({ id: crypto.randomUUID(), body: `Fresh ${i}` })
        )
      );
      expect((await library.usage()).captures).toBe(100);
    } finally {
      await db.execute(sql`delete from "user" where id = ${userId}`);
    }
  }
);
it.skipIf(!process.env.DATABASE_URL)(
  "never sweeps an image waiting for bytes and wakes it even after its wait deadline",
  async () => {
    const userId = await newUser(db);
    try {
      const jobs = openImports(db, userId),
        library = openLibrary(db, userId),
        id = crypto.randomUUID(),
        imageId = crypto.randomUUID();
      await jobs.create({ id, total: 1, spread: true });
      await jobs.append(id, { offset: 0, items: [{ imageId }] });
      await jobs.action(id, "start");
      await jobs.step(id);
      const late = new Date(Date.now() + 60 * 60_000);
      expect(await pendingImports(db, 100, late)).not.toContainEqual({
        id,
        userId,
      });
      await library.captureImage({
        id: imageId,
        importJobId: id,
        mime: "image/png",
        bytes: 2048,
        width: 800,
        height: 600,
        contentHash: "ab".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 300 },
      });
      await library.markStored(imageId);
      // Stored bytes remain recoverable if confirmation lost its wake-up.
      expect(await pendingImports(db, 100, late)).toContainEqual({
        id,
        userId,
      });
      expect(await jobs.wakeImage(imageId, late)).toBe(id);
      expect(await jobs.wakeImage(imageId, late)).toBeUndefined();
      await jobs.step(id, late);
      expect(await jobs.get(id)).toMatchObject({ state: "done", done: 1 });
    } finally {
      await db.execute(sql`delete from "user" where id = ${userId}`);
    }
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "returns a fenced allowance continuation and never Captures before midnight",
  async () => {
    const userId = await newUser(db);
    try {
      const jobs = openImports(db, userId),
        id = crypto.randomUUID();
      const now = new Date();
      now.setUTCDate(now.getUTCDate() + 1);
      now.setUTCHours(0, 1, 0, 0);
      await db.execute(
        sql`insert into usage_day (user_id,day,captures) values (${userId},${now.toISOString().slice(0, 10)},50)`
      );
      await jobs.create({ id, total: 1, spread: true });
      await jobs.append(id, {
        offset: 0,
        items: [{ url: "https://midnight.test/one" }],
      });
      await jobs.action(id, "start");
      const due = new Date(now);
      due.setUTCHours(24, 0, 0, 0);
      const waiting = await jobs.step(id, now);
      expect(waiting).toMatchObject({ dueAt: due.toISOString() });
      const early = new Date(now.getTime() + 12 * 60 * 60_000);
      const again = await jobs.step(id, early, waiting!.lease);
      expect(again).toMatchObject({ dueAt: due.toISOString() });
      expect(again!.lease).not.toBe(waiting!.lease);
      expect(await jobs.step(id, early, waiting!.lease)).toBeUndefined();
      expect(await jobs.get(id)).toMatchObject({ done: 0 });
      await jobs.step(id, due, again!.lease);
      expect(await jobs.get(id)).toMatchObject({ done: 1, state: "done" });
    } finally {
      await db.execute(sql`delete from "user" where id=${userId}`);
    }
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "continues an image allowance wait, then ends the chain while bytes are missing",
  async () => {
    const userId = await newUser(db);
    try {
      const jobs = openImports(db, userId),
        id = crypto.randomUUID();
      const now = new Date();
      now.setUTCDate(now.getUTCDate() + 1);
      now.setUTCHours(0, 1, 0, 0);
      await db.execute(
        sql`insert into usage_day (user_id,day,captures) values (${userId},${now.toISOString().slice(0, 10)},50)`
      );
      await jobs.create({ id, total: 1, spread: true });
      await jobs.append(id, {
        offset: 0,
        items: [{ imageId: crypto.randomUUID() }],
      });
      await jobs.action(id, "start");
      const due = new Date(now);
      due.setUTCHours(24, 0, 0, 0);
      const waiting = await jobs.step(id, now);
      expect(waiting).toMatchObject({ dueAt: due.toISOString() });
      const again = await jobs.step(
        id,
        new Date(now.getTime() + 12 * 60 * 60_000),
        waiting!.lease
      );
      expect(again).toMatchObject({ dueAt: due.toISOString() });
      expect(await pendingImports(db, 100, now)).not.toContainEqual({
        id,
        userId,
      });
      expect(await pendingImports(db, 100, due)).toContainEqual({ id, userId });
      expect(await jobs.step(id, due, again!.lease)).toBeUndefined();
      expect(await jobs.get(id)).toMatchObject({ done: 0, state: "running" });
      expect(
        await pendingImports(
          db,
          100,
          new Date(due.getTime() + 24 * 60 * 60_000)
        )
      ).not.toContainEqual({ id, userId });
    } finally {
      await db.execute(sql`delete from "user" where id=${userId}`);
    }
  }
);
