import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  type ImageCapture,
  type PdfCapture,
  type ReelCopy,
} from "@spark/core";
import {
  indexingStore,
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

  describe("a reel's copy (#20)", () => {
    const reel = async (library: ReturnType<typeof openLibrary>) => {
      const result = await library.captureLink({
        url: `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`,
      });
      if (!("memory" in result)) throw new Error("conflict");
      return result.memory;
    };
    const copyOf = (bytes: number): ReelCopy => ({
      bytes,
      duration: 30,
      frames: [{ seconds: 1, bytes: 1000, width: 540, height: 960 }],
    });

    it("takes storage for the video and its frames, and never a Capture", async () => {
      const { library } = await person();
      const memory = await reel(library);
      const before = await library.usage();
      await library.attachCopy(memory.id, copyOf(5000));
      expect(await library.usage()).toEqual({
        ...before,
        storageBytes: before.storageBytes + 5000 + 1000,
      });
    });

    it("fits exactly into what storage has left, and not one byte more", async () => {
      const { library } = await person();
      const memory = await reel(library);
      const used = FREE_ALLOWANCE.storageBytes - 6000;
      const holder = await library.captureImage(image({ bytes: 100 }));
      if (!("memory" in holder)) throw new Error("not created");
      await db.execute(
        sql`update memory_file set bytes = ${used - 300}
            where memory_id = ${holder.memory.id} and role = 'original'`
      );
      expect(await library.attachCopy(memory.id, copyOf(5001))).toEqual({
        refused: "storage_full",
      });
      expect(await library.attachCopy(memory.id, copyOf(5000))).toMatchObject({
        uploads: expect.any(Array),
      });
      expect((await library.usage()).storageBytes).toBe(
        FREE_ALLOWANCE.storageBytes
      );
    });

    it("counts a replaced copy once, so a second attach is not refused for the first", async () => {
      const { library } = await person();
      const memory = await reel(library);
      await library.attachCopy(memory.id, copyOf(5000));
      await library.attachCopy(memory.id, copyOf(7000));
      expect((await library.usage()).storageBytes).toBe(7000 + 1000);
    });

    it("refuses a video over the upload limit with its reason, taking nothing", async () => {
      const { library } = await person();
      const memory = await reel(library);
      expect(
        await library.attachCopy(
          memory.id,
          copyOf(FREE_ALLOWANCE.maxUploadBytes + 1)
        )
      ).toEqual({ refused: "file_too_large" });
      expect((await library.usage()).storageBytes).toBe(0);
    });
  });

  describe("captured over the limit: no AI work, ever (Codex S1)", () => {
    const REEL = () =>
      `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`;
    const readable = {
      title: "Basil",
      text: "Basil grows best in warm light and regular water. ".repeat(8),
    };
    const stateOf = async (id: string) => {
      const { rows } = await db.execute<{
        index_state: string;
        index_run: number;
        over_allowance: boolean;
      }>(
        sql`select index_state, index_run, over_allowance from memory where id = ${id}`
      );
      return rows[0]!;
    };
    const over = async () => {
      const who = await person();
      await takenToday(who.id, LIMIT);
      return who;
    };

    it("keeps a bare link out of Indexing when it is saved again with readable text, and keeps the text", async () => {
      const { library } = await over();
      const url = "https://garden.test/bare";
      const first = await library.captureLink({ url });
      if (!("memory" in first)) throw new Error("conflict");
      const before = await stateOf(first.memory.id);
      expect(before).toMatchObject({
        index_state: "searchable",
        over_allowance: true,
      });

      const again = await library.captureLink({ url, page: readable });
      expect(again).toMatchObject({
        created: false,
        duplicate: true,
        memory: { id: first.memory.id, indexState: "searchable" },
      });
      expect(again).not.toHaveProperty("indexAgain");
      expect(await stateOf(first.memory.id)).toEqual(before);
      // Free to keep, so it is findable by its words; still no Capture taken.
      expect((await library.get(first.memory.id))!.body).toContain(
        "Basil grows"
      );
      expect((await library.usage()).captures).toBe(LIMIT);
    });

    it("still restarts Indexing for a duplicate fill of a link captured within the limit", async () => {
      const { library } = await person();
      const url = "https://garden.test/within";
      await library.captureLink({ url });
      const again = await library.captureLink({ url, page: readable });
      expect(again).toMatchObject({ indexAgain: true });
    });

    it("never wants, takes or confirms a reel's copy", async () => {
      const { library } = await over();
      const reel = await library.captureLink({ url: REEL() });
      if (!("memory" in reel)) throw new Error("conflict");
      expect(await library.wantsCopy(reel.memory.id)).toBe(false);
      expect(
        await library.attachCopy(reel.memory.id, {
          bytes: 5000,
          duration: 30,
          frames: [{ seconds: 1, bytes: 1000, width: 540, height: 960 }],
        })
      ).toEqual({ refused: "captures_full" });
      expect((await library.usage()).storageBytes).toBe(0);
      expect(await stateOf(reel.memory.id)).toMatchObject({
        index_state: "searchable",
      });
    });

    it("does not confirm a copy stored for a Memory that is over the limit", async () => {
      const { library } = await person();
      const reel = await library.captureLink({ url: REEL() });
      if (!("memory" in reel)) throw new Error("conflict");
      await library.attachCopy(reel.memory.id, {
        bytes: 5000,
        duration: 30,
        frames: [{ seconds: 1, bytes: 1000, width: 540, height: 960 }],
      });
      // It went over the limit after the copy was taken (a flag set by the Capture).
      await db.execute(
        sql`update memory set over_allowance = true, index_state = 'searchable' where id = ${reel.memory.id}`
      );
      const stored = await library.markCopyStored(
        reel.memory.id,
        async () => "stored"
      );
      expect(stored).toBeUndefined();
      expect(await stateOf(reel.memory.id)).toMatchObject({
        index_state: "searchable",
      });
    });

    it("does not retry, re-embed or take Indexing work for it", async () => {
      const { library } = await over();
      const made = await library.capture({ body: "late note" });
      if (!("memory" in made)) throw new Error("conflict");
      const id = made.memory.id;
      await db.execute(
        sql`update memory set index_state = 'failed' where id = ${id}`
      );
      await library.retryIndexing(id);
      expect(await stateOf(id)).toMatchObject({ index_state: "failed" });
      await db.execute(
        sql`update memory set index_state = 'searchable' where id = ${id}`
      );

      const store = indexingStore(db);
      expect(await store.load(id)).toBeUndefined();
      expect(await store.loadForEmbedding(id, "m@3")).toBeUndefined();
      expect(
        (await store.staleVectors("m@3", 1000)).map((m) => m.id)
      ).not.toContain(id);
    });

    it("keeps a text edit and an AI opt-out round trip from Indexing it", async () => {
      const { library } = await over();
      const made = await library.capture({ body: "late note" });
      if (!("memory" in made)) throw new Error("conflict");
      const id = made.memory.id;
      const edited = await library.edit(
        id,
        { body: "late note, edited" },
        made.memory.revision
      );
      expect(edited).toMatchObject({ indexState: "searchable" });
      await library.setAiOptOut(id, true);
      await library.setAiOptOut(id, false);
      expect(await stateOf(id)).toMatchObject({ index_state: "searchable" });
    });

    it("still Indexes a Capture within the limit", async () => {
      const { library } = await person();
      const made = await library.capture({ body: "within the limit" });
      expect(made).toMatchObject({ memory: { indexState: "indexing" } });
    });
  });

  describe("what takes storage, files and reel copies together (Codex S2)", () => {
    const reel = async (library: ReturnType<typeof openLibrary>) => {
      const result = await library.captureLink({
        url: `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`,
      });
      if (!("memory" in result)) throw new Error("conflict");
      return result.memory;
    };
    const copyOf = (bytes: number): ReelCopy => ({
      bytes,
      duration: 30,
      frames: [{ seconds: 1, bytes: 1000, width: 540, height: 960 }],
    });

    it("lists a Library filled only by reel copies", async () => {
      const { library } = await person();
      const small = await reel(library);
      const big = await reel(library);
      await library.attachCopy(small.id, copyOf(2000));
      await library.attachCopy(big.id, copyOf(9000));
      const largest = await library.largest(5);
      expect(largest.map((m) => [m.id, m.bytes])).toEqual([
        [big.id, 10_000],
        [small.id, 3000],
      ]);
      expect(largest[0]).toMatchObject({ kind: "video" });
      expect(largest.reduce((n, m) => n + m.bytes, 0)).toBe(
        (await library.usage()).storageBytes
      );
    });

    it("adds a Memory's files and its copy before ranking, across mixed Memories", async () => {
      const { library } = await person();
      const picture = await library.captureImage(image({ bytes: 9000 }));
      if (!("memory" in picture)) throw new Error("not created");
      const withBoth = await reel(library);
      await db.execute(
        sql`insert into memory_file (memory_id, role, r2_key, mime, bytes, stored_at)
            values (${withBoth.id}, 'screenshot', ${`k/${crypto.randomUUID()}`}, 'image/jpeg', 4000, now())`
      );
      await library.attachCopy(withBoth.id, copyOf(5000));
      const largest = await library.largest(5);
      // 4000 + 5000 + 1000 = 10000 beats the picture's 9000 + 300.
      expect(largest.map((m) => [m.id, m.bytes])).toEqual([
        [withBoth.id, 10_000],
        [picture.memory.id, 9300],
      ]);
    });

    it("leaves out a copy whose upload window ran out, as usedStorage does", async () => {
      const { library } = await person();
      const stale = await reel(library);
      await library.attachCopy(stale.id, copyOf(5000));
      await db.execute(
        sql`update memory_copy set created_at = now() - interval '3 days' where memory_id = ${stale.id}`
      );
      expect(await library.largest(5)).toEqual([]);
      expect((await library.usage()).storageBytes).toBe(0);
    });
  });
});
