import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { FREE_ALLOWANCE, type ImageCapture } from "@spark/core";
import { openDatabase, openLibrary, type Database } from "../index";
import { newUser } from "./users";

// Text and links past the daily allowance are bounded: SEC-2.
const databaseUrl = process.env.DATABASE_URL;
const LIMIT = FREE_ALLOWANCE.capturesPerDay;
const KEPT = FREE_ALLOWANCE.keptPerDay;

describe.skipIf(!databaseUrl)("text past the Free allowance", () => {
  let db: Database;
  let close: () => Promise<void>;
  const people: string[] = [];
  beforeAll(() => {
    ({ db, close } = openDatabase(databaseUrl!));
  });
  afterAll(async () => {
    for (const id of people)
      await db.execute(sql`delete from "user" where id = ${id}`);
    await close();
  });
  const person = async () => {
    const id = await newUser(db);
    people.push(id);
    return { id, library: openLibrary(db, id) };
  };
  const image = (): ImageCapture => ({
    id: crypto.randomUUID(),
    mime: "image/png",
    bytes: 100,
    width: 800,
    height: 600,
    contentHash: "ab".repeat(32),
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    thumbnail: { mime: "image/webp", bytes: 300 },
  });
  /** Fills the Library with one image so `left` bytes of storage remain. */
  const fillUpTo = async (
    library: ReturnType<typeof openLibrary>,
    left: number
  ) => {
    const holder = await library.captureImage(image());
    if (!("memory" in holder)) throw new Error("not created");
    const used = await library.usedStorage();
    await db.execute(
      sql`update memory_file set bytes = bytes + ${FREE_ALLOWANCE.storageBytes - left - used}
          where memory_id = ${holder.memory.id} and role = 'original'`
    );
    expect(await library.usedStorage()).toBe(
      FREE_ALLOWANCE.storageBytes - left
    );
  };
  const today = sql`(now() at time zone 'utc')::date`;
  const counts = (userId: string, captures: number, kept = 0) =>
    db.execute(
      sql`insert into usage_day (user_id, day, captures, kept)
          values (${userId}, ${today}, ${captures}, ${kept})
          on conflict (user_id, day) do update set captures = ${captures}, kept = ${kept}`
    );
  const rows = async (userId: string) =>
    (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from memory where user_id = ${userId}`
      )
    ).rows[0]!.n;

  it("keeps at most the daily keeps past the Captures, then refuses and stores nothing", async () => {
    const { id, library } = await person();
    await counts(id, LIMIT, KEPT - 1);
    const lastKeep = await library.capture({ body: "the last keep" });
    expect(lastKeep).toMatchObject({
      created: true,
      memory: { indexState: "searchable" },
    });
    const before = await rows(id);
    expect(await library.capture({ body: "one too many" })).toEqual({
      refused: "captures_full",
    });
    expect(
      await library.captureLink({
        url: "https://garden.test/too-many",
        page: { text: "A page the browser read", title: "Too many" },
      })
    ).toEqual({ refused: "captures_full" });
    expect(await rows(id)).toBe(before);
  });

  it("refuses links past the keeps and keeps one within them with its text", async () => {
    const { id, library } = await person();
    await counts(id, LIMIT, KEPT - 1);
    const kept = await library.captureLink({
      url: "https://garden.test/kept",
      page: { text: "Readable words", title: "Kept" },
    });
    expect(kept).toMatchObject({
      created: true,
      memory: { indexState: "searchable" },
    });
    expect(
      await library.captureLink({ url: "https://garden.test/refused" })
    ).toEqual({ refused: "captures_full" });
  });

  it("holds the keeps under parallel saves", async () => {
    const { id, library } = await person();
    await counts(id, LIMIT, KEPT - 3);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => library.capture({ body: `p${i}` }))
    );
    expect(results.filter((r) => "memory" in r)).toHaveLength(3);
    expect(results.filter((r) => "refused" in r)).toHaveLength(5);
  });

  it("does not charge a retry of a save that already exists", async () => {
    const { id, library } = await person();
    await counts(id, LIMIT, KEPT);
    const memoryId = crypto.randomUUID();
    await db.execute(
      sql`insert into memory (id, user_id, kind, body) values (${memoryId}, ${id}, 'text', 'saved before')`
    );
    expect(
      await library.capture({ id: memoryId, body: "saved before" })
    ).toMatchObject({
      created: false,
    });
  });

  it("counts text toward storage and refuses what no longer fits", async () => {
    const { id, library } = await person();
    await fillUpTo(library, 20);
    expect(await library.capture({ body: "fits in ten" })).toMatchObject({
      created: true,
    });
    expect(await library.capture({ body: "does not fit at all" })).toEqual({
      refused: "storage_full",
    });
    expect(
      await library.captureLink({
        url: "https://garden.test/full",
        page: { text: "Words that do not fit. ".repeat(40) },
      })
    ).toEqual({ refused: "storage_full" });
    // Only the image and the one text were stored.
    expect(await rows(id)).toBe(2);
    expect((await library.usage()).storageBytes).toBe(
      FREE_ALLOWANCE.storageBytes - 20 + "fits in ten".length
    );
  });

  it("refuses an edit that grows text past storage, and lets one that shrinks it through", async () => {
    const { library } = await person();
    const made = await library.capture({ body: "small" });
    if (!("memory" in made)) throw new Error("not created");
    await fillUpTo(library, 100);
    expect(
      await library.edit(made.memory.id, { body: "b".repeat(500) })
    ).toEqual({ refused: "storage_full" });
    expect(await library.get(made.memory.id)).toMatchObject({ body: "small" });
    expect(
      await library.edit(made.memory.id, { captureNote: "n".repeat(300) })
    ).toEqual({ refused: "storage_full" });
    expect(
      await library.edit(made.memory.id, { body: "tiny edit" })
    ).toMatchObject({ body: "tiny edit" });
    expect(await library.edit(made.memory.id, { body: "s" })).toMatchObject({
      body: "s",
    });
  });

  it("caps the typo-matching words one Memory writes", async () => {
    const { library } = await person();
    const words = Array.from(
      { length: 6000 },
      (_, i) => `word${i.toString(36)}zz`
    );
    const made = await library.capture({ body: words.join(" ") });
    if (!("memory" in made)) throw new Error("not created");
    const { rows: counted } = await db.execute<{ n: number; first: string }>(
      sql`select count(*)::int as n, min(word) as first from memory_word where memory_id = ${made.memory.id}`
    );
    expect(counted[0]!.n).toBe(4000);
    // The earliest words are kept.
    const { rows: head } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from memory_word where memory_id = ${made.memory.id} and word = ${words[0]}`
    );
    expect(head[0]!.n).toBe(1);
  });
});
