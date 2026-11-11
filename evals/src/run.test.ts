import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@spark/db";
import { loadSet } from "./manifest";
import { runEvals } from "./run";
import { fakeSetup, openLocalDatabase } from "./setup";

// The scorer end to end against real Postgres: Capture (text and image),
// Indexing with the replay provider, and full search with the fake embedder.
describe.skipIf(!process.env.DATABASE_URL)("runEvals", () => {
  let db: Database;
  let close: () => Promise<void>;
  beforeAll(() => ({ db, close } = openLocalDatabase()));
  afterAll(async () => close());

  const pick = async (...ids: string[]) => {
    const set = await loadSet();
    return { ...set, memories: set.memories.filter((i) => ids.includes(i.id)) };
  };

  it("finds Memories it captured, an image by its text and a note by its words", async () => {
    const set = await pick(
      "note-passport-renewal",
      "shot-wifi-card",
      "img-orange-cat"
    );
    const report = await runEvals({
      db,
      memories: set.memories,
      searches: [
        {
          id: "a",
          query: "passport appointment 3 May",
          expect: ["note-passport-renewal"],
          kind: "date",
        },
        {
          id: "b",
          query: "wifi password orange falcon",
          expect: ["shot-wifi-card"],
          kind: "text in image",
        },
        {
          id: "c",
          query: "nothing like it anywhere zzqx",
          expect: ["img-orange-cat"],
          kind: "none",
        },
      ],
      ...(await fakeSetup(set.memories)),
    });
    expect(report.searches.map((s) => s.rank)).toEqual([1, 1, null]);
    expect(report.searches.every((s) => !s.fellBack)).toBe(true);
    expect(report.searches[1]!.matchedBy.length).toBeGreaterThan(0);
  });

  it("leaves nothing behind: the throwaway person and their Memories are gone", async () => {
    const before = await db.execute<{ n: string }>(
      sql`select count(*) as n from memory`
    );
    const set = await pick("note-passport-renewal", "img-red-car");
    await runEvals({
      db,
      memories: set.memories,
      searches: [],
      ...(await fakeSetup(set.memories)),
    });
    const after = await db.execute<{ n: string }>(
      sql`select count(*) as n from memory`
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("still Indexes an image the manifest has no recorded extraction for", async () => {
    const set = await pick("img-red-car");
    const setup = await fakeSetup(set.memories);
    const broken = {
      ...set.memories[0]!,
      image: { ...set.memories[0]!.image!, contentHash: "0".repeat(64) },
    };
    // No recorded answer by hash: the replay provider gives an empty one, and the Memory is still Searchable.
    const report = await runEvals({
      db,
      memories: [broken],
      searches: [],
      ...setup,
    });
    expect(report.memories).toBe(1);
  });
});
