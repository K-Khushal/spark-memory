import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  openDatabase,
  openImports,
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
    expect(await jobs.step(id, now)).toBeUndefined();
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
