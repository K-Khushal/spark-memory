import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openDatabase, openLibrary, type Database } from "../index";
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

type Lib = ReturnType<typeof openLibrary>;
async function image(
  library: Lib,
  {
    palette,
    sourceUrl,
    title,
  }: { palette?: string[]; sourceUrl?: string; title?: string },
  stored = true
) {
  const id = crypto.randomUUID();
  await library.captureImage({
    id,
    mime: "image/png",
    bytes: 2048,
    width: 800,
    height: 600,
    contentHash: "ab".repeat(32),
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    ...(palette && { palette: palette.map((c) => c.toLowerCase()) }),
    ...(sourceUrl && { sourceUrl }),
    thumbnail: { mime: "image/webp", bytes: 300 },
  });
  if (stored) await library.markStored(id);
  if (title) await library.edit(id, { title });
  return id;
}
async function text(library: Lib, body: string) {
  const r = await library.capture({ body });
  if ("conflict" in r) throw new Error("conflict");
  return r.memory.id;
}
const ids = (results: { id: string }[]) => results.map((r) => r.id);
const ORANGE = "#EE7A1C";
const BLUE = "#2F6FE0";

describe.skipIf(!url)("search filters", () => {
  it("browses with no words: nothing without filters, newest first with them", async () => {
    const { library } = await person();
    const old = await text(library, "an old note");
    const recent = await text(library, "a recent note");
    await db.execute(
      sql`update memory set captured_at = now() - interval '3 days' where id = ${old}`
    );
    expect(await library.search("")).toEqual([]);
    expect(
      ids(
        await library.search("", { filters: { after: "2000-01-01T00:00:00Z" } })
      )
    ).toEqual([recent, old]);
  });

  it("pages a browse by cursor: no repeats or gaps, even for the same instant", async () => {
    const { id, library } = await person();
    // Seven Memories, three of them saved in the same microsecond.
    await db.execute(sql`
      insert into memory (user_id, kind, title, body, captured_at)
      select ${id}, 'text', 'n' || n, 'body', timestamptz '2026-10-01 12:00:00+00'
        + (case when n <= 3 then 0 else n end || ' seconds')::interval
        + (case when n <= 3 then 0 else 123456 end || ' microseconds')::interval
      from generate_series(1, 7) n`);
    const all = ids(
      await library.search("", {
        filters: { after: "2000-01-01T00:00:00Z" },
        limit: 100,
      })
    );
    expect(all).toHaveLength(7);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const got = ids(
        await library.search("", {
          filters: { after: "2000-01-01T00:00:00Z" },
          limit: 2,
          ...(cursor && { cursor }),
        })
      );
      if (!got.length) break;
      seen.push(...got);
      cursor = got.at(-1);
    }
    expect(seen).toEqual(all);
    // A cursor that names no Memory of mine ends the list; it never restarts it.
    expect(
      await library.search("", {
        filters: { after: "2000-01-01T00:00:00Z" },
        cursor: crypto.randomUUID(),
      })
    ).toEqual([]);
  });

  it("does not take another person's Memory as a cursor", async () => {
    const mine = await person();
    const theirs = await person();
    await text(mine.library, "mine");
    const theirId = await text(theirs.library, "theirs");
    expect(
      await mine.library.search("", {
        filters: { after: "2000-01-01T00:00:00Z" },
        cursor: theirId,
      })
    ).toEqual([]);
  });

  it("limits to a kind, and to when it was captured (start included, end not)", async () => {
    const { library } = await person();
    const note = await text(library, "budget");
    const picture = await image(library, { title: "budget" });
    expect(ids(await library.search("budget", { kinds: ["image"] }))).toEqual([
      picture,
    ]);
    expect(
      ids(
        await library.search("", {
          kinds: ["text"],
          filters: { after: "2000-01-01T00:00:00Z" },
        })
      )
    ).toEqual([note]);

    await db.execute(
      sql`update memory set captured_at = '2026-10-01T00:00:00Z' where id = ${note}`
    );
    await db.execute(
      sql`update memory set captured_at = '2026-11-01T00:00:00Z' where id = ${picture}`
    );
    const october = {
      after: "2026-10-01T00:00:00Z",
      before: "2026-11-01T00:00:00Z",
    };
    expect(ids(await library.search("", { filters: october }))).toEqual([note]);
    expect(ids(await library.search("budget", { filters: october }))).toEqual([
      note,
    ]);
    expect(
      ids(
        await library.search("", { filters: { after: "2026-11-01T00:00:00Z" } })
      )
    ).toEqual([picture]);
  });

  it("matches a Source by its host exactly, subdomains included", async () => {
    const { library } = await person();
    const own = await image(library, {
      sourceUrl: "https://www.instagram.com/p/one",
    });
    await image(library, {
      sourceUrl: "https://instagram.com.evil.test/p/two",
    });
    await image(library, { sourceUrl: "https://notinstagram.com/p/three" });
    await image(library, {});
    const short = await image(library, { sourceUrl: "https://youtu.be/abc" });
    const long = await image(library, {
      sourceUrl: "https://m.youtube.com/watch?v=abc",
    });
    expect(
      ids(await library.search("", { filters: { hosts: ["instagram.com"] } }))
    ).toEqual([own]);
    expect(
      ids(
        await library.search("", {
          filters: { hosts: ["youtube.com", "youtu.be"] },
        })
      ).sort()
    ).toEqual([short, long].sort());
  });

  it("filters before it limits, so a narrow filter still finds its few", async () => {
    const { id, library } = await person();
    // More matching notes than any search leg keeps (100), all older.
    await db.execute(sql`
      insert into memory (user_id, kind, title, body, captured_at)
      select ${id}, 'text', 'lantern ' || n, 'lantern', now() - interval '30 days'
      from generate_series(1, 120) n`);
    const wanted = await text(library, "lantern");
    const since = { after: new Date(Date.now() - 86_400_000).toISOString() };
    expect(ids(await library.search("lantern", { filters: since }))).toEqual([
      wanted,
    ]);
  });

  it("keeps one person's Memories out of another's filtered browse", async () => {
    const mine = await person();
    const theirs = await person();
    await image(theirs.library, {
      palette: [ORANGE],
      sourceUrl: "https://instagram.com/p/x",
    });
    expect(
      await mine.library.search("", {
        filters: { colour: ORANGE, hosts: ["instagram.com"] },
      })
    ).toEqual([]);
  });

  it("leaves out a Memory whose file is not stored yet, as the wall does", async () => {
    const { library } = await person();
    await image(library, { palette: [ORANGE] }, false);
    expect(await library.search("", { filters: { colour: ORANGE } })).toEqual(
      []
    );
  });
});

describe.skipIf(!url)("colour", () => {
  it("browses a colour closest first, and says which colour matched", async () => {
    const { library } = await person();
    const close = await image(library, { palette: ["#E8821F"] });
    const exact = await image(library, { palette: [BLUE, ORANGE] });
    const near = await image(library, { palette: ["#D98A3A"] });
    await image(library, { palette: [BLUE] });
    await image(library, { palette: ["#1A1A1A", "#F5F6F8"] });
    await image(library, {});
    const results = await library.search("", { filters: { colour: ORANGE } });
    expect(ids(results)).toEqual([exact, close, near]);
    expect(results[0]!.part).toEqual({
      kind: "filter",
      field: "colour",
      value: ORANGE.toLowerCase(),
    });
    expect(results[1]!.part).toEqual({
      kind: "filter",
      field: "colour",
      value: "#e8821f",
    });
  });

  it("pages through a colour without repeats or gaps", async () => {
    const { library } = await person();
    const made: string[] = [];
    for (let i = 0; i < 5; i++)
      made.push(await image(library, { palette: ["#EE7A1C"] }));
    const filters = { colour: ORANGE };
    const seen: string[] = [];
    for (let offset = 0; offset < 6; offset += 2)
      seen.push(
        ...ids(await library.search("", { filters, limit: 2, offset }))
      );
    expect(seen.sort()).toEqual([...made].sort());
    expect(await library.search("", { filters, limit: 2, offset: 5 })).toEqual(
      []
    );
  });

  it("narrows a colour by kind, Source and date together", async () => {
    const { library } = await person();
    const hit = await image(library, {
      palette: [ORANGE],
      sourceUrl: "https://pinterest.com/pin/1",
    });
    await image(library, {
      palette: [ORANGE],
      sourceUrl: "https://reddit.com/r/x",
    });
    expect(
      ids(
        await library.search("", {
          kinds: ["image"],
          filters: {
            colour: ORANGE,
            hosts: ["pinterest.com"],
            after: "2000-01-01T00:00:00Z",
          },
        })
      )
    ).toEqual([hit]);
  });

  it("lets a preferred colour break ties, but only lifts a Memory a few places", async () => {
    const { library } = await person();
    const orange = await image(library, {
      palette: [ORANGE],
      title: "animation reel",
    });
    // Thirty equal matches, all newer, so the orange one is last without the colour.
    const blues: string[] = [];
    for (let i = 0; i < 30; i++)
      blues.push(
        await image(library, { palette: [BLUE], title: "animation reel" })
      );
    const plain = ids(await library.search("animation reel", { limit: 40 }));
    expect(plain.at(-1)).toBe(orange);
    const lifted = ids(
      await library.search("animation reel", {
        limit: 40,
        filters: { prefer: ORANGE },
      })
    );
    // Up, but not to the top: the words still decide.
    expect(lifted.indexOf(orange)).toBeLessThan(plain.indexOf(orange));
    expect(lifted.indexOf(orange)).toBeGreaterThan(5);
    // Nothing is dropped.
    expect([...lifted].sort()).toEqual([...plain].sort());
    // Equal words: the colour breaks the tie.
    const two = await person();
    const old = await image(two.library, {
      palette: [ORANGE],
      title: "animation reel",
    });
    const newer = await image(two.library, {
      palette: [BLUE],
      title: "animation reel",
    });
    expect(ids(await two.library.search("animation reel"))).toEqual([
      newer,
      old,
    ]);
    expect(
      ids(
        await two.library.search("animation reel", {
          filters: { prefer: ORANGE },
        })
      )
    ).toEqual([old, newer]);
  });
});
