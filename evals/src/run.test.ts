import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openLibrary, schema, type Database } from "@spark/db";
import { loadSet } from "./manifest";
import { memoryId, runEvals, type Reranker } from "./run";
import { fakeSetup, openLocalDatabase } from "./setup";

// The scorer end to end against real Postgres: Capture (text and image),
// Indexing with the replay provider, and full search with the fake embedder.
// Each test runs Capture, Indexing and search: give a loaded machine room.
describe.skipIf(!process.env.DATABASE_URL)(
  "runEvals",
  { timeout: 60_000 },
  () => {
    let db: Database;
    let close: () => Promise<void>;
    beforeAll(() => ({ db, close } = openLocalDatabase()));
    afterAll(async () => close());

    const pick = async (...ids: string[]) => {
      const set = await loadSet();
      return {
        ...set,
        memories: set.memories.filter((i) => ids.includes(i.id)),
      };
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

    it("gives a reranker what Indexing persisted, built as the vectors are", async () => {
      const set = await pick("shot-wifi-card", "note-passport-renewal");
      const seen: { id: string; text: string }[] = [];
      await runEvals({
        db,
        memories: set.memories,
        searches: [
          {
            id: "b",
            query: "wifi password orange falcon",
            expect: ["shot-wifi-card"],
            kind: "x",
          },
        ],
        ...(await fakeSetup(set.memories)),
        rerank: async (_query, candidates) => {
          seen.push(...candidates);
          return candidates.map((c) => c.id);
        },
      });
      const wifi = seen.find((c) => c.id === "shot-wifi-card")!;
      // The Overview input: title and description as Indexing stored them,
      // in the document format the embedder reads, not the manifest's canned text.
      expect(wifi.text).toContain("title: Guest Wi-Fi card | text:");
      expect(wifi.text).toContain("guest Wi-Fi card on a teal background");
      expect(wifi.text).toContain("Lighthouse_5G");
    });

    it("scores a reranked order by where the right Memory lands after it", async () => {
      const set = await pick(
        "note-gym-plan",
        "note-lisbon-trip",
        "note-q2-planning-meeting"
      );
      const run = async (expect: string[], rerank?: Reranker) =>
        (
          await runEvals({
            db,
            memories: set.memories,
            searches: [{ id: "p", query: "plan", expect, kind: "x" }],
            ...(await fakeSetup(set.memories)),
            rerank,
          })
        ).searches[0]!;
      const first = (await run([])).top[0]!;
      const plain = await run([first]);
      // A reranker that puts the first result last.
      const reranked = await run([first], async (_q, candidates) =>
        candidates.map((c) => c.id).reverse()
      );
      expect(plain.rank).toBe(1);
      expect(reranked.rank).toBeGreaterThanOrEqual(2);
      // matchedBy follows the Memory found, not its old position.
      expect(reranked.matchedBy.length).toBeGreaterThan(0);
    });

    it("leaves nothing behind: the throwaway person and their Memories are gone", async () => {
      // Only the scorer's own people: other tests write to this database too.
      const mine = sql`from "user" u left join memory m on m.user_id = u.id where u.email like 'evals-%@example.com'`;
      const count = async () =>
        (
          await db.execute<{ users: string; memories: string }>(
            sql`select count(distinct u.id) as users, count(m.id) as memories ${mine}`
          )
        ).rows[0]!;
      const before = await count();
      const set = await pick("note-passport-renewal", "img-red-car");
      await runEvals({
        db,
        memories: set.memories,
        searches: [],
        ...(await fakeSetup(set.memories)),
      });
      // Other runs' leftovers may be cleaned meanwhile, so never more than before.
      const after = await count();
      expect(Number(after.users)).toBeLessThanOrEqual(Number(before.users));
      expect(Number(after.memories)).toBeLessThanOrEqual(
        Number(before.memories)
      );
      // Independent of other runs: none of this run's sample Memories remains
      // under any throwaway person.
      const ids = set.memories.map((sample) => memoryId(sample.id));
      const { rows: left } = await db.execute(sql`
        select m.id from memory m join "user" u on u.id = m.user_id
        where u.email like 'evals-%@example.com'
          and m.id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `
          )})
      `);
      expect(left).toHaveLength(0);
    });

    it("clears what a stopped run left behind, so the next run does not conflict", async () => {
      const set = await pick("note-passport-renewal");
      // A run killed before its cleanup: a throwaway person who still owns the
      // sample's Memory id.
      const leftover = crypto.randomUUID();
      await db.insert(schema.user).values({
        id: leftover,
        name: "",
        email: `evals-${leftover}@example.com`,
      });
      const captured = await openLibrary(db, leftover).capture({
        id: memoryId("note-passport-renewal"),
        body: "left behind by a stopped run",
      });
      expect("memory" in captured).toBe(true);
      const report = await runEvals({
        db,
        memories: set.memories,
        searches: [],
        ...(await fakeSetup(set.memories)),
      });
      expect(report.memories).toBe(1);
      const { rows } = await db.execute(
        sql`select 1 from "user" where id = ${leftover}`
      );
      expect(rows).toHaveLength(0);
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
  }
);
