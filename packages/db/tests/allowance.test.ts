import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  type ImageCapture,
  type PdfCapture,
} from "@spark/core";
import {
  openDatabase,
  openLibrary,
  openOnboarding,
  type Database,
} from "../index";
import { newUser } from "./users";

// The Free allowance's counted limits (#27) against real Postgres.
const databaseUrl = process.env.DATABASE_URL;
const LIMIT = FREE_ALLOWANCE.capturesPerDay;

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

const pdf = (over: Partial<PdfCapture> = {}): PdfCapture => ({
  id: crypto.randomUUID(),
  bytes: 40_000,
  contentHash: "cd".repeat(32),
  title: "Lease",
  pages: 1,
  width: 612,
  height: 792,
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: 300 },
  pageImages: [{ bytes: 1000, width: 1024, height: 1325 }],
  ...over,
});

describe.skipIf(!databaseUrl)("Captures in the Free allowance", () => {
  let db: Database;
  let close: () => Promise<void>;
  const people: string[] = [];

  beforeAll(() => {
    ({ db, close } = openDatabase(databaseUrl!));
  });
  afterAll(async () => {
    for (const id of people) {
      await db.execute(sql`delete from "user" where id = ${id}`);
    }
    await close();
  });

  const person = async () => {
    const id = await newUser(db);
    people.push(id);
    return { id, library: openLibrary(db, id) };
  };

  /** Today's count, as if `n` Captures were already taken. */
  const takenToday = (userId: string, n: number) =>
    db.execute(
      sql`insert into usage_day (user_id, day, captures)
          values (${userId}, (now() at time zone 'utc')::date, ${n})
          on conflict (user_id, day) do update set captures = ${n}`
    );

  it("counts each new Memory once, and not a retry or a page saved again", async () => {
    const { library } = await person();
    const id = crypto.randomUUID();
    await library.capture({ id, body: "one" });
    await library.capture({ id, body: "one" });
    await library.captureLink({ url: "https://garden.test/a" });
    await library.captureLink({ url: "https://garden.test/a" });
    const file = image();
    await library.captureImage(file);
    await library.captureImage(file);
    await library.capturePdf(pdf());
    expect((await library.usage()).captures).toBe(4);
  });

  it("takes the last Capture of the day whole, and keeps the next partly Indexed", async () => {
    const { id, library } = await person();
    await takenToday(id, LIMIT - 1);

    const last = await library.capture({ body: "the hundredth" });
    expect(last).toMatchObject({
      created: true,
      memory: { indexState: "indexing" },
    });

    const over = await library.capture({ body: "the hundred and first" });
    expect(over).toMatchObject({
      created: true,
      memory: { indexState: "searchable" },
    });
    expect((await library.usage()).captures).toBe(LIMIT);
  });

  it("keeps a link over the limit as Reference only, with what the browser sent", async () => {
    const { id, library } = await person();
    await takenToday(id, LIMIT);
    const result = await library.captureLink({
      url: "https://garden.test/late",
    });
    expect(result).toMatchObject({
      created: true,
      memory: {
        sourceUrl: "https://garden.test/late",
        preservation: "reference_only",
        indexState: "searchable",
      },
    });
    expect((await library.list())!.memories).toHaveLength(1);
  });

  it("refuses a file over the limit with its reason, taking no storage", async () => {
    const { id, library } = await person();
    await takenToday(id, LIMIT);
    expect(await library.captureImage(image())).toEqual({
      refused: "captures_full",
    });
    expect(await library.capturePdf(pdf())).toEqual({
      refused: "captures_full",
    });
    expect(await library.usedStorage()).toBe(0);
    expect((await library.list())!.memories).toHaveLength(0);
  });

  it("still serves a file retry over the limit, as the Memory already exists", async () => {
    const { id, library } = await person();
    const file = image();
    await library.captureImage(file);
    await takenToday(id, LIMIT);
    expect(await library.captureImage(file)).toMatchObject({ created: false });
  });

  it("does not hold yesterday's count against today", async () => {
    const { id, library } = await person();
    await db.execute(
      sql`insert into usage_day (user_id, day, captures)
          values (${id}, (now() at time zone 'utc')::date - 1, ${LIMIT})`
    );
    expect(await library.captureImage(image())).toMatchObject({
      created: true,
    });
    expect((await library.usage()).captures).toBe(1);
  });

  it("holds the limit under parallel Captures", async () => {
    const { library } = await person();
    const results = await Promise.all(
      Array.from({ length: LIMIT + 20 }, (_, i) =>
        library.capture({ body: `note ${i}` })
      )
    );
    const whole = results.filter(
      (r) => "memory" in r && r.memory.indexState === "indexing"
    );
    expect(whole).toHaveLength(LIMIT);
    expect((await library.usage()).captures).toBe(LIMIT);
    expect((await library.list({}))!.memories.length).toBeGreaterThan(0);
  });

  it("holds the limit for files in parallel, refusing the rest", async () => {
    const { id, library } = await person();
    await takenToday(id, LIMIT - 5);
    const results = await Promise.all(
      Array.from({ length: 15 }, () => library.captureImage(image()))
    );
    expect(results.filter((r) => "memory" in r)).toHaveLength(5);
    expect(results.filter((r) => "refused" in r)).toHaveLength(10);
    expect((await library.usage()).captures).toBe(LIMIT);
  });

  it("never counts Samples", async () => {
    const { id, library } = await person();
    await openOnboarding(db, id).start();
    expect(
      (await library.list())!.memories.filter((m) => m.sample)
    ).toHaveLength(3);
    expect(await library.usage()).toEqual({
      storageBytes: 0,
      captures: 0,
      deepFetches: 0,
    });
  });

  it("counts storage the same with AI opt-out on", async () => {
    const { library } = await person();
    const result = await library.captureImage(image({ bytes: 5000 }));
    if (!("memory" in result)) throw new Error("not created");
    const before = (await library.usage()).storageBytes;
    await library.setAiOptOut(result.memory.id, true);
    expect((await library.usage()).storageBytes).toBe(before);
    expect(before).toBe(5000 + 300);
  });

  it("names the Memories that take the most storage, largest first", async () => {
    const { library } = await person();
    const small = await library.captureImage(image({ bytes: 1000 }));
    const big = await library.captureImage(image({ bytes: 9000 }));
    const text = await library.capture({ body: "no files" });
    if (!("memory" in small && "memory" in big && "memory" in text)) {
      throw new Error("not created");
    }
    const largest = await library.largest(5);
    expect(largest.map((m) => m.id)).toEqual([big.memory.id, small.memory.id]);
    expect(largest[0]).toMatchObject({ kind: "image", bytes: 9300 });
  });
});
