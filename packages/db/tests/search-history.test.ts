import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  accountJobs,
  openDatabase,
  openLibrary,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

const url = process.env.DATABASE_URL;
let db: Database, close: () => Promise<void>;
const people: string[] = [];
beforeAll(async () => {
  if (!url) return;
  ({ db, close } = openDatabase(url));
});
afterAll(async () => {
  if (!url) return;
  for (const id of people) await removeUser(db, id);
  await close();
});
async function person() {
  const id = await newUser(db);
  people.push(id);
  return { id, library: openLibrary(db, id) };
}
async function note(library: ReturnType<typeof openLibrary>, body: string) {
  const r = await library.capture({ body });
  if ("conflict" in r) throw new Error("conflict");
  return r.memory.id;
}

describe.skipIf(!url)("recent searches", () => {
  it("keeps each search once, newest first, and forgets one or all", async () => {
    const { library } = await person();
    await library.rememberSearch("orange animations");
    await library.rememberSearch("tax receipts");
    await library.rememberSearch("orange animations");
    expect((await library.recentSearches()).map((s) => s.query)).toEqual([
      "orange animations",
      "tax receipts",
    ]);
    const [first] = await library.recentSearches();
    await library.forgetSearch(first!.id);
    expect((await library.recentSearches()).map((s) => s.query)).toEqual([
      "tax receipts",
    ]);
    await library.forgetSearch();
    expect(await library.recentSearches()).toEqual([]);
  });

  it("keeps twenty, and only those from the last thirty days", async () => {
    const { id, library } = await person();
    for (let i = 0; i < 22; i++) await library.rememberSearch(`query ${i}`);
    const recent = await library.recentSearches();
    expect(recent).toHaveLength(20);
    expect(recent[0]!.query).toBe("query 21");
    await db.execute(
      sql`update recent_search set searched_at = now() - interval '31 days' where user_id = ${id}`
    );
    expect(await library.recentSearches()).toEqual([]);
    expect((await library.searchData()).recentSearches).toEqual([]);
  });

  it("never lets one person see, forget or click through to another's", async () => {
    const mine = await person();
    const theirs = await person();
    const theirMemory = await note(theirs.library, "Their note");
    await theirs.library.rememberSearch("their query");
    const [theirRecent] = await theirs.library.recentSearches();
    expect(await mine.library.recentSearches()).toEqual([]);
    await mine.library.forgetSearch(theirRecent!.id);
    expect(await theirs.library.recentSearches()).toHaveLength(1);
    // A click on a Memory that is not mine is not recorded at all.
    await mine.library.rememberSearch("looking", {
      memoryId: theirMemory,
      position: 1,
    });
    expect((await mine.library.searchData()).searchEvents).toEqual([]);
  });
});

describe.skipIf(!url)("search events", () => {
  it("records the query, the clicked result and its place, and reformulation", async () => {
    const { library } = await person();
    const memory = await note(library, "Animation reference");
    await library.rememberSearch("animation");
    await library.rememberSearch("animations", undefined, true);
    await library.rememberSearch("animations", {
      memoryId: memory,
      position: 2,
    });
    const { searchEvents } = await library.searchData();
    expect(searchEvents).toMatchObject([
      {
        query: "animation",
        memoryId: null,
        position: null,
        reformulation: false,
      },
      {
        query: "animations",
        memoryId: null,
        position: null,
        reformulation: true,
      },
      {
        query: "animations",
        memoryId: memory,
        position: 2,
        reformulation: false,
      },
    ]);
  });

  it("records a click from browsing, where there are no words", async () => {
    const { library } = await person();
    const memory = await note(library, "Receipt");
    await library.rememberSearch("", { memoryId: memory, position: 1 });
    expect((await library.searchData()).searchEvents).toMatchObject([
      { query: "", memoryId: memory, position: 1 },
    ]);
    expect(await library.recentSearches()).toEqual([]);
  });

  it("keeps the latest thousand and nothing past thirty days", async () => {
    const { id, library } = await person();
    await db.execute(sql`
      insert into search_event (user_id, query, occurred_at)
      select ${id}, 'q' || n, now() - (n || ' minutes')::interval from generate_series(1, 1005) n`);
    await library.rememberSearch("one more");
    const { searchEvents } = await library.searchData();
    expect(searchEvents).toHaveLength(1000);
    expect(searchEvents.some((e) => e.query === "one more")).toBe(true);
    await db.execute(
      sql`update search_event set occurred_at = now() - interval '31 days' where user_id = ${id}`
    );
    expect((await library.searchData()).searchEvents).toEqual([]);
  });

  it("is physically removed by the sweep once past thirty days", async () => {
    const { id, library } = await person();
    await library.rememberSearch("old news");
    await db.execute(
      sql`update recent_search set searched_at = now() - interval '31 days' where user_id = ${id}`
    );
    await db.execute(
      sql`update search_event set occurred_at = now() - interval '31 days' where user_id = ${id}`
    );
    await accountJobs(db).sweepSearchHistory();
    const left = await db.execute(
      sql`select (select count(*) from recent_search where user_id = ${id}) as recents, (select count(*) from search_event where user_id = ${id}) as events`
    );
    expect(left.rows[0]).toMatchObject({ recents: "0", events: "0" });
  });

  it("goes with the person, and keeps its place when a Memory goes", async () => {
    const gone = await person();
    const memory = await note(gone.library, "Short lived");
    await gone.library.rememberSearch("short", {
      memoryId: memory,
      position: 1,
    });
    await gone.library.remove(memory);
    expect((await gone.library.searchData()).searchEvents).toMatchObject([
      { query: "short", memoryId: null },
    ]);
    await removeUser(db, gone.id);
    const left = await db.execute(
      sql`select (select count(*) from recent_search where user_id = ${gone.id}) as recents, (select count(*) from search_event where user_id = ${gone.id}) as events`
    );
    expect(left.rows[0]).toMatchObject({ recents: "0", events: "0" });
  });
});
