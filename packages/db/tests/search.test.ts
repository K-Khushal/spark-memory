import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { IndexingOutput } from "@spark/core";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
  type Embedding,
} from "../index";
import { newUser, removeUser } from "./users";

// Hybrid search (migrations/0013) against real Postgres, with fixed vectors:
// each concept is one axis, so what is near what is known exactly.
const databaseUrl = process.env.DATABASE_URL;

const DIMS = 768;
const MODEL = "test-embedding";
const space = { model: MODEL, dimensions: DIMS };

/** A unit vector mixing the given axes by weight. */
function mix(weights: Record<number, number>) {
  const v = new Array<number>(DIMS).fill(0);
  for (const [axis, w] of Object.entries(weights)) v[Number(axis)] = w;
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}

const found = (over: Partial<IndexingOutput> = {}): IndexingOutput => ({
  title: "",
  description: "",
  ocrText: "",
  entities: [],
  tags: [],
  language: "en",
  ...over,
});

describe.skipIf(!databaseUrl)("hybrid search", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ana = await newUser(db);
    ben = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, ana);
    await removeUser(db, ben);
    await close();
  });

  const library = (userId = ana) => openLibrary(db, userId);
  const store = () => indexingStore(db);

  /** A text Memory, Indexed with `extraction` and `vectors` (each a concept mix). */
  async function save(
    memory: { title?: string; body: string; captureNote?: string },
    {
      userId = ana,
      extraction = found(),
      vectors = [] as Embedding["vectors"],
      model = MODEL,
    } = {}
  ) {
    const result = await library(userId).capture(memory);
    if (!("memory" in result)) throw new Error("conflict");
    const { id } = result.memory;
    const loaded = (await store().load(id))!;
    await store().complete(
      { ...loaded, memoryId: id },
      { output: extraction, model: "fake" },
      { model, dimensions: DIMS, revision: loaded.revision, vectors }
    );
    return id;
  }

  const search = (
    query: string,
    vector?: number[],
    options: { userId?: string; maxDistance?: number } = {}
  ) =>
    library(options.userId).search(query, {
      ...(vector && { probe: { ...space, vector } }),
      ...(options.maxDistance !== undefined && {
        maxDistance: options.maxDistance,
      }),
    });

  it("image queries use Visual and Overview, exclude Passages and other owners, and keep filters", async () => {
    const vector = mix({ 180: 1 });
    const visual = await save(
      { body: "Picture" },
      { vectors: [{ kind: "visual", embedding: vector }] }
    );
    const passage = await save(
      { body: "Passage only" },
      {
        vectors: [
          {
            kind: "passage",
            anchor: { field: "body", start: 0, end: 12 },
            embedding: vector,
          },
        ],
      }
    );
    const overview = await save(
      { body: "Overview" },
      { vectors: [{ kind: "overview", embedding: vector }] }
    );
    const foreign = await save(
      { body: "Other Library" },
      { userId: ben, vectors: [{ kind: "visual", embedding: vector }] }
    );
    const results = await library().search("", {
      probe: { ...space, vector, imageQuery: true },
      maxDistance: 0.1,
      kinds: ["text"],
    });
    expect(results.map((m) => m.id).sort()).toEqual([visual, overview].sort());
    expect(results.map((m) => m.id)).not.toContain(passage);
    expect(results.map((m) => m.id)).not.toContain(foreign);
    expect(
      await library().search("", {
        probe: { ...space, vector, imageQuery: true },
        kinds: ["pdf"],
      })
    ).toEqual([]);
    expect(
      await library().search("", {
        probe: { ...space, like: foreign, imageQuery: true },
      })
    ).toEqual([]);
    expect(
      (
        await library().search("", {
          probe: { ...space, like: overview, imageQuery: true },
          maxDistance: 0.1,
        })
      ).map((m) => m.id)
    ).toEqual([visual]);
  });

  describe("the vector leg", () => {
    let console_: string;
    let pier: string;
    beforeAll(async () => {
      console_ = await save(
        {
          title: "Admin console",
          body: "Sidebar navigation with analytics charts.\n\nA violet accent, and night mode on by default.",
        },
        {
          vectors: [
            { kind: "overview", embedding: mix({ 0: 1 }) },
            {
              kind: "passage",
              anchor: { field: "body", start: 43, end: 92 },
              embedding: mix({ 0: 1, 1: 1, 2: 1 }),
            },
          ],
        }
      );
      pier = await save(
        { body: "Boats rocking, gulls, the sky turning orange" },
        { vectors: [{ kind: "visual", embedding: mix({ 9: 1, 10: 1 }) }] }
      );
    });

    it("finds a Memory by meaning when none of the words are in it, and says which passage matched", async () => {
      const [top] = await search(
        "dark dashboard with a purple sidebar",
        mix({ 0: 1, 1: 1, 2: 1 })
      );
      expect(top).toMatchObject({
        id: console_,
        matched: ["vector"],
        part: { kind: "passage", field: "body", start: 43, end: 92 },
      });
      expect(top!.distance).toBeCloseTo(0, 2);
    });

    it("says the Overview matched when a Passage is exactly as close, whatever order the rows were written in", async () => {
      // The same point twice: a short text's Passage often says what its Overview says.
      const same = mix({ 30: 1, 31: 1 });
      for (const vectors of [
        [
          { kind: "overview" as const, embedding: same },
          {
            kind: "passage" as const,
            anchor: { field: "body" as const, start: 0, end: 4 },
            embedding: same,
          },
        ],
        [
          {
            kind: "passage" as const,
            anchor: { field: "body" as const, start: 0, end: 4 },
            embedding: same,
          },
          { kind: "overview" as const, embedding: same },
        ],
      ]) {
        const id = await save({ body: "Tied" }, { vectors });
        const hits = await search("", same);
        expect(hits.find((m) => m.id === id)?.part).toEqual({
          kind: "overview",
        });
      }
    });

    it("settles equally close vectors of one kind by page, then place, whatever order they were written in", async () => {
      const same = mix({ 40: 1, 41: 1 });
      const visual = (page: number) => ({
        kind: "visual" as const,
        anchor: { page },
        embedding: same,
      });
      const passage = (start: number) => ({
        kind: "passage" as const,
        anchor: { field: "body" as const, start, end: start + 2 },
        embedding: same,
      });
      for (const [vectors, part] of [
        [[visual(3), visual(1)], { kind: "visual", page: 1 }],
        [[visual(1), visual(3)], { kind: "visual", page: 1 }],
        [
          [passage(2), passage(0)],
          { kind: "passage", field: "body", start: 0, end: 2 },
        ],
        [
          [passage(0), passage(2)],
          { kind: "passage", field: "body", start: 0, end: 2 },
        ],
      ] as const) {
        const id = await save({ body: "Tie" }, { vectors: [...vectors] });
        const hits = await search("", same);
        expect(hits.find((m) => m.id === id)?.part).toEqual(part);
      }
    });

    it("says an image matched when its Visual vector was closest", async () => {
      const [top] = await search("sunset at the harbour", mix({ 9: 1, 10: 1 }));
      expect(top).toMatchObject({ id: pier, part: { kind: "visual" } });
    });

    it("leaves out Memories further than the cutoff", async () => {
      const far = await search("unrelated", mix({ 30: 1 }));
      expect(far.map((r) => r.id)).not.toContain(console_);
      const near = await search("close", mix({ 0: 1, 30: 0.2 }), {
        maxDistance: 0.1,
      });
      expect(near.map((r) => r.id)).toEqual([console_]);
    });

    it("reads only vectors of the query's model and size", async () => {
      const other = await save(
        { body: "Another model's vectors" },
        {
          model: "old-model",
          vectors: [{ kind: "overview", embedding: mix({ 40: 1 }) }],
        }
      );
      const ids = (await search("x", mix({ 40: 1 }))).map((r) => r.id);
      expect(ids).not.toContain(other);
    });

    it("is instant search without a probe: keyword and typo only", async () => {
      const results = await library().search("violet");
      expect(results.map((r) => r.id)).toEqual([console_]);
      expect(results[0]).toMatchObject({
        matched: ["keyword"],
        distance: null,
        part: { kind: "field", field: "text" },
      });
    });

    it("never matches another person's vectors", async () => {
      expect(
        await search("x", mix({ 0: 1, 1: 1, 2: 1 }), { userId: ben })
      ).toEqual([]);
      const theirs = await save(
        { body: "Ben's console" },
        {
          userId: ben,
          vectors: [{ kind: "overview", embedding: mix({ 0: 1 }) }],
        }
      );
      const ids = (await search("x", mix({ 0: 1 }))).map((r) => r.id);
      expect(ids).not.toContain(theirs);
    });

    it("never returns another person's Memory, even from a vector row filed under the wrong person", async () => {
      const theirs = await save({ body: "Ben's diary" }, { userId: ben });
      await db.insert(schema.memoryVector).values({
        memoryId: theirs,
        userId: ana,
        kind: "overview",
        model: MODEL,
        dimensions: DIMS,
        embedding: mix({ 90: 1 }),
      });
      const raw = async (vector: number[] | null, like: string | null) =>
        (
          await db.execute<{ id: string }>(
            sql`select id from search_memories(${ana}, '', 40, ${vector && `[${vector.join(",")}]`}::halfvec, ${like}::uuid, ${MODEL}, ${DIMS})`
          )
        ).rows.map((r) => r.id);
      expect(await raw(mix({ 90: 1 }), null)).not.toContain(theirs);
      // Nor can Ben's Memory be the probe for More Like This.
      expect(await raw(null, theirs)).toEqual([]);
    });
  });

  describe("fusion", () => {
    it("ranks a Memory found by keyword and by meaning above one found by either", async () => {
      const both = await save(
        { body: "Glaze recipe: lemon and sugar" },
        { vectors: [{ kind: "overview", embedding: mix({ 50: 1, 51: 0.3 }) }] }
      );
      const keywordOnly = await save({ body: "Glaze the windows" });
      const vectorOnly = await save(
        { body: "Icing for a cake" },
        { vectors: [{ kind: "overview", embedding: mix({ 50: 1 }) }] }
      );
      const ids = (await search("glaze", mix({ 50: 1 }))).map((r) => r.id);
      expect(ids[0]).toBe(both);
      expect(ids).toEqual(expect.arrayContaining([keywordOnly, vectorOnly]));
    });

    it("names the field a keyword matched in: title, Capture note, Tags, text or text in an image", async () => {
      await save(
        { title: "Quokka", body: "a", captureNote: "wombat" },
        { extraction: found({ tags: ["numbat"], description: "dingo" }) }
      );
      const field = async (q: string) => (await library().search(q))[0]?.part;
      expect(await field("quokka")).toEqual({ kind: "field", field: "title" });
      expect(await field("wombat")).toEqual({ kind: "field", field: "note" });
      expect(await field("numbat")).toEqual({ kind: "field", field: "tags" });
      // A text Memory's description retells its text.
      expect(await field("dingo")).toEqual({ kind: "field", field: "text" });

      const captured = await library().captureImage({
        id: crypto.randomUUID(),
        mime: "image/png",
        bytes: 2048,
        width: 800,
        height: 600,
        contentHash: "ab".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 300 },
      });
      if (!("memory" in captured)) throw new Error("not created");
      const { id } = captured.memory;
      await library().markStored(id);
      const loaded = (await store().load(id))!;
      await store().complete(
        { ...loaded, memoryId: id },
        {
          output: found({
            ocrText: "bilby sale",
            description: "A bilby poster",
          }),
          model: "fake",
        }
      );
      expect(await field("sale")).toEqual({ kind: "field", field: "ocr" });
      expect(await field("poster")).toEqual({
        kind: "field",
        field: "description",
      });
      expect(await field("bilby")).toEqual({ kind: "field", field: "ocr" });
    });

    it("filters by kind", async () => {
      expect(await library().search("violet", { kinds: ["image"] })).toEqual(
        []
      );
    });
  });

  describe("More Like This", () => {
    it("searches with a Memory's Overview and Visual, leaving it out", async () => {
      const cat = await save(
        { body: "Mochi asleep on the radiator" },
        { vectors: [{ kind: "overview", embedding: mix({ 60: 1 }) }] }
      );
      const kitten = await save(
        { body: "A kitten in a box" },
        { vectors: [{ kind: "overview", embedding: mix({ 60: 1, 61: 0.4 }) }] }
      );
      const results = await library().search("", {
        probe: { ...space, like: cat },
      });
      expect(results[0]).toMatchObject({
        id: kitten,
        part: { kind: "overview" },
      });
      expect(results.map((r) => r.id)).not.toContain(cat);
      // Never from another person's Memory.
      expect(
        await library(ben).search("", { probe: { ...space, like: cat } })
      ).toEqual([]);
    });
  });

  describe("vectors follow the Memory", () => {
    const spaceName = `${MODEL}@${DIMS}`;
    const embedding = (revision: number): Embedding => ({
      model: MODEL,
      dimensions: DIMS,
      revision,
      vectors: [{ kind: "overview", embedding: mix({ 70: 1 }) }],
    });
    const stale = async () =>
      (await store().staleVectors(spaceName, 10_000)).map((m) => m.id);

    it("says whether a Memory has vectors in the space search uses now", async () => {
      const id = await save(
        { body: "Lighthouse" },
        { vectors: [{ kind: "overview", embedding: mix({ 73: 1 }) }] }
      );
      const has = (vectorsSpace?: string) =>
        openLibrary(db, ana, vectorsSpace ? { vectorsSpace } : {})
          .get(id)
          .then((m) => m?.hasVectors);
      expect(await has(spaceName)).toBe(true);
      // Another model, or no embedder at all (no paid tier): none to use.
      expect(await has("next-model@768")).toBe(false);
      expect(await has()).toBe(false);
      await library().setAiOptOut(id, true);
      expect(await has(spaceName)).toBe(false);
    });

    it("drops a Memory's vectors with the edit that changes its text, and keeps them for a new title", async () => {
      const id = await save(
        { body: "Harbour at dusk" },
        { vectors: [{ kind: "overview", embedding: mix({ 72: 1 }) }] }
      );
      const vectors = async () =>
        (
          await db
            .select({ kind: schema.memoryVector.kind })
            .from(schema.memoryVector)
            .where(eq(schema.memoryVector.memoryId, id))
        ).length;
      await library().edit(id, { title: "Renamed" });
      expect(await vectors()).toBe(1);
      await library().edit(id, { body: "Groceries" });
      expect(await vectors()).toBe(0);
      const [row] = await db
        .select({
          space: schema.memory.vectorsSpace,
          revision: schema.memory.vectorsRevision,
        })
        .from(schema.memory)
        .where(eq(schema.memory.id, id));
      expect(row).toEqual({ space: null, revision: null });
    });

    it("drops vectors made from text edited while they were made, and the sweep finds it", async () => {
      const result = await library().capture({ body: "Draft" });
      if (!("memory" in result)) throw new Error("conflict");
      const { id } = result.memory;
      const loaded = (await store().load(id))!;
      await library().edit(id, { title: "Renamed while Indexing" });
      await store().complete(
        { ...loaded, memoryId: id },
        { output: found(), model: "fake" },
        embedding(loaded.revision)
      );
      expect(
        (await search("x", mix({ 70: 1 }))).map((r) => r.id)
      ).not.toContain(id);
      expect(await stale()).toContain(id);

      // The embed job: taken once, written at the current revision.
      const job = (await store().loadForEmbedding(id, spaceName))!;
      expect(await store().loadForEmbedding(id, spaceName)).toBeUndefined();
      expect(job.found).toBeDefined();
      expect(
        await store().stillEmbeddable({ ...job, memoryId: id }, job.revision)
      ).toBe(true);
      expect(
        await store().writeVectors(
          { ...job, memoryId: id },
          embedding(job.revision)
        )
      ).toBe(true);
      // Categories are due too (made by the indexer between embedding and writing).
      expect(await stale()).toContain(id);
      expect(
        await store().writeCategories({ ...job, memoryId: id }, job.revision, [
          "Other",
        ])
      ).toBe(true);
      expect(await stale()).not.toContain(id);
      expect((await search("x", mix({ 70: 1 })))[0]?.id).toBe(id);

      // A model change makes every vector stale.
      expect(
        (await store().staleVectors("next-model@768", 10_000)).map((m) => m.id)
      ).toContain(id);
    });

    it("refuses vectors once the text was edited or AI opt-out switched on", async () => {
      const id = await save(
        { body: "Bank statement" },
        { vectors: [{ kind: "overview", embedding: mix({ 71: 1 }) }] }
      );
      await library().edit(id, { title: "Statement" });
      const job = (await store().loadForEmbedding(id, spaceName))!;
      await library().edit(id, { title: "Edited again" });
      expect(
        await store().stillEmbeddable({ ...job, memoryId: id }, job.revision)
      ).toBe(false);
      expect(
        await store().writeVectors(
          { ...job, memoryId: id },
          embedding(job.revision)
        )
      ).toBe(false);

      expect((await search("x", mix({ 71: 1 })))[0]?.id).toBe(id);
      await library().setAiOptOut(id, true);
      expect(
        (await search("x", mix({ 71: 1 }))).map((r) => r.id)
      ).not.toContain(id);
      expect(await stale()).not.toContain(id);
      expect(await store().loadForEmbedding(id, spaceName)).toBeUndefined();
    });
  });
});

/**
 * The fusion fixture set (until evals/ has a harness, #11): vague searches
 * that share no word with what they look for, and keyword searches that
 * must not regress. Reports top-1 and top-5 for instant (keyword) search
 * and hybrid search.
 */
describe.skipIf(!databaseUrl)("fusion fixture set", () => {
  let db: Database;
  let close: () => Promise<void>;
  let userId: string;
  const ids = new Map<string, string>();

  // Concept axes: 0 dashboard, 1 purple, 2 dark, 3 bread, 4 japan, 5 running,
  // 6 invoice, 7 cat, 8 coffee, 9 evening, 10 harbour, 11 recipe, 12 training,
  // 13 shoes, 14 travel, 15 flowers.
  const LIBRARY: [string, string, Record<number, number>][] = [
    [
      "console",
      "Sidebar navigation with analytics charts, a violet accent, night mode",
      { 0: 1, 1: 1, 2: 1 },
    ],
    [
      "bread",
      "Levain at 8am, bulk ferment five hours, bake in a dutch oven",
      { 3: 1, 11: 0.5 },
    ],
    ["kyoto", "Fushimi Inari at dawn, then matcha in Uji", { 4: 1, 14: 0.6 }],
    [
      "marathon",
      "Long run on Sundays, tempo on Wednesdays, taper two weeks",
      { 5: 1, 12: 1 },
    ],
    ["invoice", "Invoice 0042 for design work, due in 30 days", { 6: 1 }],
    ["mochi", "Our cat sleeps on the radiator all winter", { 7: 1 }],
    ["espresso", "18 grams in, 36 out, 28 seconds", { 8: 1, 11: 0.6 }],
    ["pier", "Boats rocking, gulls, the sky turning orange", { 9: 1, 10: 1 }],
    ["light", "White analytics page with green charts", { 0: 1 }],
    ["soup", "Roast tomatoes with paprika before blending", { 11: 1 }],
    ["shoes", "Pegasus 41 for daily miles", { 5: 1, 13: 1 }],
    ["lavender", "Lavender field in Provence", { 1: 1, 14: 1, 15: 1 }],
  ];
  const QUERIES: [string, string, Record<number, number>][] = [
    [
      "dark dashboard with a purple sidebar",
      "console",
      { 0: 1, 1: 1, 2: 1, 20: 0.3 },
    ],
    ["sourdough schedule", "bread", { 3: 1, 21: 0.3 }],
    ["temple trip in japan", "kyoto", { 4: 1, 14: 0.5, 22: 0.3 }],
    ["training for a race", "marathon", { 5: 0.8, 12: 1, 23: 0.3 }],
    ["bill for client work", "invoice", { 6: 1, 24: 0.3 }],
    ["kitty", "mochi", { 7: 1, 25: 0.3 }],
    ["coffee brew ratio", "espresso", { 8: 1, 11: 0.3, 26: 0.3 }],
    ["sunset at the harbour", "pier", { 9: 1, 10: 1, 27: 0.3 }],
    ["paprika", "soup", { 11: 1, 28: 0.3 }],
    ["pegasus", "shoes", { 13: 0.5, 5: 1, 29: 0.3 }],
    ["lavender", "lavender", { 15: 1, 1: 0.4, 30: 0.3 }],
    ["inari", "kyoto", { 4: 0.5, 31: 1 }],
  ];

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    userId = await newUser(db);
    const library = openLibrary(db, userId);
    const store = indexingStore(db);
    for (const [name, body, concepts] of LIBRARY) {
      const result = await library.capture({ body });
      if (!("memory" in result)) throw new Error("conflict");
      const { id } = result.memory;
      const loaded = (await store.load(id))!;
      await store.complete(
        { ...loaded, memoryId: id },
        { output: found(), model: "fake" },
        {
          ...space,
          revision: loaded.revision,
          vectors: [{ kind: "overview", embedding: mix(concepts) }],
        }
      );
      ids.set(name, id);
    }
  });
  afterAll(async () => {
    await removeUser(db, userId);
    await close();
  });

  it("finds at least as many targets first and in the top five as keyword search, and loses no keyword hit", async () => {
    const library = openLibrary(db, userId);
    const score = {
      instant: { top1: 0, top5: 0 },
      hybrid: { top1: 0, top5: 0 },
    };
    for (const [query, target, concepts] of QUERIES) {
      const want = ids.get(target);
      for (const mode of ["instant", "hybrid"] as const) {
        const results = await library.search(query, {
          ...(mode === "hybrid" && {
            probe: { ...space, vector: mix(concepts) },
          }),
        });
        const at = results.findIndex((r) => r.id === want);
        if (at === 0) score[mode].top1++;
        if (at >= 0 && at < 5) score[mode].top5++;
        // A keyword search that found its Memory first still does.
        if (mode === "hybrid" && results.length) {
          const instant = await library.search(query);
          if (instant[0]?.id === want) expect(results[0]?.id).toBe(want);
        }
      }
    }
    const n = QUERIES.length;
    console.log(
      `fusion fixtures (${n} searches): keyword top-1 ${score.instant.top1}/${n}, top-5 ${score.instant.top5}/${n}; ` +
        `hybrid top-1 ${score.hybrid.top1}/${n}, top-5 ${score.hybrid.top5}/${n}`
    );
    expect(score.hybrid.top1).toBeGreaterThanOrEqual(score.instant.top1);
    expect(score.hybrid.top5).toBeGreaterThanOrEqual(score.instant.top5);
    expect(score.hybrid.top1).toBe(n);
  });
});
