import { afterAll, beforeAll, expect, it } from "vitest";
import { openDatabase, openLibrary, type Database } from "../index";
import { newUser, removeUser } from "./users";
let db: Database, close: () => Promise<void>, owner: string;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  ({ db, close } = openDatabase(process.env.DATABASE_URL!));
  owner = await newUser(db);
});
afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  await removeUser(db, owner);
  await close();
});
it.skipIf(!process.env.DATABASE_URL)(
  "browses filters before limiting and keeps search history per owner",
  async () => {
    const library = openLibrary(db, owner);
    const captured = await library.capture({ body: "oranges on a table" });
    if ("conflict" in captured) throw new Error("capture conflict");
    expect(
      (await library.search("", { filters: { kinds: ["text"] } })).map(
        (m) => m.id
      )
    ).toContain(captured.memory.id);
    expect(await library.search("", { filters: { kinds: ["pdf"] } })).toEqual(
      []
    );
    await library.rememberSearch("orange animations");
    await library.rememberSearch("orange animations");
    expect((await library.recentSearches()).map((s) => s.query)).toEqual([
      "orange animations",
    ]);
    const [recent] = await library.recentSearches();
    await library.forgetSearch(recent!.id);
    expect(await library.recentSearches()).toEqual([]);
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "scopes history, clicks and export data to the owner and honors deletion",
  async () => {
    const self = await newUser(db);
    const other = await newUser(db);
    try {
      const library = openLibrary(db, self);
      const theirs = openLibrary(db, other);
      const result = await theirs.capture({ body: "Their search result" });
      if ("conflict" in result) throw new Error("capture conflict");
      await library.rememberSearch("private query", {
        memoryId: result.memory.id,
        position: 1,
      });
      expect(await library.recentSearches()).toEqual([]);
      await Promise.all([
        library.rememberSearch("first query"),
        library.rememberSearch("second query", undefined, true),
      ]);
      expect(await theirs.recentSearches()).toEqual([]);
      const data = await library.searchData();
      expect(data.searchEvents).toHaveLength(2);
      expect(data.searchEvents.some((e) => e.reformulation === true)).toBe(
        true
      );
      await library.forgetSearch();
      expect((await library.searchData()).recentSearches).toEqual([]);
      await theirs.rememberSearch("disposable history");
      await removeUser(db, other);
      expect((await theirs.searchData()).searchEvents).toEqual([]);
    } finally {
      await removeUser(db, other);
      await removeUser(db, self);
    }
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "ranks stored palettes and paginates colour browsing with exact Source boundaries",
  async () => {
    const self = await newUser(db);
    const library = openLibrary(db, self);
    try {
      const ids: string[] = [];
      for (const [palette, sourceUrl] of [
        [["#f97316"], "https://www.instagram.com/p/one"],
        [["#f97316"], "https://instagram.com.evil.test/p/two"],
        [["#3b82f6"], "https://instagram.com/p/three"],
      ] as const) {
        const id = crypto.randomUUID();
        await library.captureImage({
          id,
          mime: "image/png",
          bytes: 2048,
          width: 800,
          height: 600,
          contentHash: "ab".repeat(32),
          thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
          palette: [...palette],
          sourceUrl,
          thumbnail: { mime: "image/webp", bytes: 300 },
        });
        await library.markStored(id);
        await library.edit(id, { title: "Animation" });
        ids.push(id);
      }
      const filters = { colour: "#f97316" };
      const first = await library.search("", { filters, limit: 1 });
      const second = await library.search("", { filters, limit: 1, offset: 1 });
      expect(new Set([first[0]!.id, second[0]!.id])).toEqual(
        new Set(ids.slice(0, 2))
      );
      expect(await library.search("", { filters, offset: 2 })).toEqual([]);
      expect(
        (
          await library.search("", {
            filters: { ...filters, source: "instagram.com" },
          })
        ).map((m) => m.id)
      ).toEqual([ids[0]]);
      expect(first[0]!.part).toEqual({ kind: "filter", field: "colour" });
      await library.rememberSearch("", { memoryId: ids[0]!, position: 2 });
      expect((await library.searchData()).searchEvents[0]).toMatchObject({
        query: "",
        memory_id: ids[0],
        position: 2,
      });
      expect(await library.recentSearches()).toEqual([]);
      const ranked = await library.search("Animation", { filters });
      expect(
        ranked
          .slice(0, 2)
          .map((m) => m.id)
          .sort()
      ).toEqual(ids.slice(0, 2).sort());
    } finally {
      await removeUser(db, self);
    }
  }
);
