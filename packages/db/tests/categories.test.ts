import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  CATEGORISING,
  CATEGORY_NAMES,
  embeddingSpace,
  type Category,
  type IndexingOutput,
} from "@spark/core";
import {
  createIndexer,
  type CategoryClient,
  type Embedder,
  type Provider,
} from "@spark/indexing";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

const url = process.env.DATABASE_URL;

/** Reads "recipe" or "video" in a text; Category prototypes are their own axes. */
function embedder(): Embedder & { texts: string[] } {
  const texts: string[] = [];
  const axis = (name: Category) => {
    const v = new Array<number>(CATEGORY_NAMES.length).fill(0);
    v[CATEGORY_NAMES.indexOf(name)] = 1;
    return v;
  };
  return {
    name: "fake",
    model: "categories-embedding",
    dimensions: CATEGORY_NAMES.length,
    texts,
    async embed(inputs) {
      const vectors = inputs.map((input) => {
        const text = "text" in input ? input.text : "";
        texts.push(text);
        const proto = CATEGORY_NAMES.find(
          (n) => CATEGORISING.prototypes[n] === text
        );
        if (proto) return axis(proto);
        if (/recipe/i.test(text)) return axis("Recipe");
        if (/video/i.test(text)) return axis("Video");
        return new Array<number>(CATEGORY_NAMES.length).fill(0);
      });
      return { vectors, usage: { textTokens: 10, imageTokens: 0 } };
    },
  };
}

const found = (over: Partial<IndexingOutput> = {}): IndexingOutput => ({
  title: "Lemon tart",
  description: "A recipe for a lemon tart",
  ocrText: "",
  entities: [],
  tags: [],
  language: "en",
  ...over,
});
const provider = (): Provider => ({
  name: "fake",
  model: "fake",
  async extract() {
    return {
      text: JSON.stringify(found()),
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
});

/** A Jev stand-in at the client seam. */
function jev(
  scores: Partial<Record<Category, number>> | Error
): CategoryClient & { calls: { text: string; names: readonly string[] }[] } {
  const calls: { text: string; names: readonly string[] }[] = [];
  return {
    model: "fake-jev",
    calls,
    async classify(text, names) {
      calls.push({ text, names });
      if (scores instanceof Error) throw scores;
      return { scores, inputTokens: 100 };
    },
  };
}

describe.skipIf(!url)("Categories", () => {
  let db: Database;
  let close: () => Promise<void>;
  let owner: string;
  const others: string[] = [];
  beforeAll(async () => {
    ({ db, close } = openDatabase(url!));
    owner = await newUser(db);
  });
  afterAll(async () => {
    for (const id of others) await removeUser(db, id);
    await removeUser(db, owner);
    await close();
  });

  const library = () => openLibrary(db, owner);
  const capture = async (body: string) => {
    const saved = await library().capture({ body });
    if (!("memory" in saved)) throw new Error("capture");
    return saved.memory;
  };
  const row = async (id: string) =>
    (
      await db
        .select({
          categories: schema.memory.categories,
          locked: schema.memory.categoriesLocked,
          categoriesRevision: schema.memory.categoriesRevision,
          categoriesVersion: schema.memory.categoriesVersion,
          revision: schema.memory.revision,
          vectorsRevision: schema.memory.vectorsRevision,
          run: schema.memory.indexRun,
        })
        .from(schema.memory)
        .where(eq(schema.memory.id, id))
    )[0]!;
  const indexer = (
    embed: Embedder,
    client?: CategoryClient,
    store = indexingStore(db)
  ) =>
    createIndexer({
      store,
      providers: [provider()],
      embedder: embed,
      ...(client && { jev: client }),
      readFile: async () => undefined,
    }).index;
  const job = (id: string, run: number, task: "index" | "embed" = "index") => ({
    memoryId: id,
    run,
    priority: "fresh" as const,
    attempt: 1,
    task,
  });
  const aiCalls = (id: string) =>
    db.select().from(schema.aiCall).where(eq(schema.aiCall.memoryId, id));

  it("starts as Other until Indexing decides", async () => {
    const m = await capture("anything");
    expect(await row(m.id)).toMatchObject({
      categories: ["Other"],
      locked: false,
      categoriesRevision: null,
    });
  });

  it("compares the embedding with the Category prototypes when Jev is off", async () => {
    const m = await capture("Lemon tart");
    await indexer(embedder())(job(m.id, 1));
    expect(await row(m.id)).toMatchObject({
      categories: ["Recipe"],
      locked: false,
      categoriesRevision: 1,
    });
  });

  it("takes every Category above the threshold from Jev, at most three, and records its cost", async () => {
    const m = await capture("Lemon tart");
    const client = jev({
      Tutorial: 0.4,
      Recipe: 0.3,
      Article: 0.2,
      Video: 0.25,
      Quote: 0.05,
    });
    await indexer(embedder(), client)(job(m.id, 1));
    expect((await row(m.id)).categories).toEqual([
      "Tutorial",
      "Recipe",
      "Video",
    ]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.names).toEqual(CATEGORY_NAMES);
    expect(client.calls[0]!.text).toContain("lemon tart");
    const [call, ...rest] = (await aiCalls(m.id)).filter(
      (c) => c.provider === "jev"
    );
    expect(rest).toEqual([]);
    expect(call).toMatchObject({
      model: "fake-jev",
      inputTokens: 100,
      estimated: false,
    });
  });

  it("falls back to embeddings, once, when Jev fails, and counts what it could have cost", async () => {
    const m = await capture("Lemon tart");
    const client = jev(new Error("timeout"));
    await indexer(embedder(), client)(job(m.id, 1));
    expect((await row(m.id)).categories).toEqual(["Recipe"]);
    expect(client.calls).toHaveLength(1);
    const jevCalls = (await aiCalls(m.id)).filter((c) => c.provider === "jev");
    expect(jevCalls).toHaveLength(1);
    expect(jevCalls[0]).toMatchObject({ estimated: true });
  });

  it("uses Other when nothing is close", async () => {
    const m = await capture("Lemon tart");
    const flat = embedder();
    const silent: Embedder = {
      ...flat,
      async embed(inputs, options) {
        const { vectors, usage } = await flat.embed(inputs, options);
        // Memory vectors point nowhere near any prototype.
        return {
          vectors: vectors.map((v, i) => {
            const input = inputs[i]!;
            const prototype =
              "text" in input &&
              CATEGORY_NAMES.some(
                (n) => CATEGORISING.prototypes[n] === input.text
              );
            return prototype ? v : new Array<number>(v.length).fill(0);
          }),
          usage,
        };
      },
    };
    await indexer(silent)(job(m.id, 1));
    expect((await row(m.id)).categories).toEqual(["Other"]);
  });

  it("never sends an AI opt-out Memory to Jev or the embedding model", async () => {
    const m = await capture("Lemon tart");
    await library().setAiOptOut(m.id, true);
    const client = jev({ Recipe: 0.9 });
    const embed = embedder();
    const run = (await row(m.id)).run;
    await indexer(embed, client)(job(m.id, run));
    expect(client.calls).toEqual([]);
    expect(embed.texts).toEqual([]);
    expect(await row(m.id)).toMatchObject({
      categories: ["Other"],
      categoriesRevision: null,
    });
  });

  it("asks nothing of Jev once the day's budget is spent, and tries again later", async () => {
    const m = await capture("Lemon tart");
    const client = jev({ Recipe: 0.9 });
    const real = indexingStore(db);
    const broke = {
      ...real,
      load: real.load,
      spentTodayMicros: async () => Number.MAX_SAFE_INTEGER,
    } as typeof real;
    await indexer(embedder(), client, broke)(job(m.id, 1));
    expect(client.calls).toEqual([]);
    expect((await row(m.id)).categoriesRevision).toBeNull();
    // The sweep finds it again once there is budget.
    const space = embeddingSpace("categories-embedding", CATEGORY_NAMES.length);
    expect((await real.staleVectors(space, 500)).map((s) => s.id)).toContain(
      m.id
    );
  });

  it("makes only Categories for a Memory whose vectors are current", async () => {
    const m = await capture("Lemon tart");
    const embed = embedder();
    await indexer(embed)(job(m.id, 1));
    const before = await row(m.id);
    // As if saved before Categories existed.
    await db
      .update(schema.memory)
      .set({ categories: ["Other"], categoriesRevision: null })
      .where(eq(schema.memory.id, m.id));
    const space = embeddingSpace(embed.model, embed.dimensions);
    const store = indexingStore(db);
    expect((await store.staleVectors(space, 500)).map((s) => s.id)).toContain(
      m.id
    );
    embed.texts.length = 0;
    const client = jev({ Tutorial: 0.7 });
    expect(await indexer(embed, client)(job(m.id, 1, "embed"))).toEqual({
      result: "searchable",
    });
    // Nothing of the Memory was embedded again.
    expect(embed.texts.some((t) => /lemon/i.test(t))).toBe(false);
    expect(await row(m.id)).toMatchObject({
      categories: ["Tutorial"],
      categoriesRevision: before.revision,
      vectorsRevision: before.vectorsRevision,
    });
    expect(
      (await store.staleVectors(space, 500)).map((s) => s.id)
    ).not.toContain(m.id);
    // The lease is back: another delivery can take it.
    await db
      .update(schema.memory)
      .set({ categoriesRevision: null })
      .where(eq(schema.memory.id, m.id));
    expect(await store.loadForEmbedding(m.id, space)).toBeDefined();
  });

  describe("Locked categories", () => {
    it("a user's choice leaves the text and vectors alone and locks", async () => {
      const m = await capture("Lemon tart");
      await indexer(embedder())(job(m.id, 1));
      const before = await row(m.id);
      const edited = await library().edit(m.id, {
        categories: ["Quote", "Idea"],
      });
      expect(edited).toMatchObject({
        categories: ["Quote", "Idea"],
        categoriesLocked: true,
        revision: before.revision,
      });
      const space = embeddingSpace(
        "categories-embedding",
        CATEGORY_NAMES.length
      );
      expect(
        (await indexingStore(db).staleVectors(space, 500)).map((s) => s.id)
      ).not.toContain(m.id);
      for (const bad of [[], ["Nope"], ["Quote", "Quote"]]) {
        await expect(
          library().edit(m.id, { categories: bad as Category[] })
        ).rejects.toThrow();
      }
    });

    it("survives a changed text, re-Indexing, the sweep and late writes", async () => {
      const m = await capture("Lemon tart");
      const embed = embedder();
      await indexer(embed)(job(m.id, 1));
      await library().edit(m.id, { categories: ["Quote", "Idea"] });

      const client = jev({ Recipe: 0.9 });
      const edited = await library().edit(m.id, { body: "A new video" });
      expect(edited).toMatchObject({
        categories: ["Quote", "Idea"],
        categoriesLocked: true,
      });
      const { run, revision } = await row(m.id);
      await indexer(embed, client)(job(m.id, run));
      expect(client.calls).toEqual([]);
      expect(await row(m.id)).toMatchObject({
        categories: ["Quote", "Idea"],
        locked: true,
      });

      // A late automatic write, and a migration-style re-gather, change nothing.
      const store = indexingStore(db);
      const loaded = {
        memoryId: m.id,
        userId: owner,
        generation: m.indexGeneration,
        run,
      };
      expect(await store.writeCategories(loaded, revision, ["Article"])).toBe(
        false
      );
      await db
        .update(schema.memory)
        .set({ categoriesRevision: null })
        .where(eq(schema.memory.id, m.id));
      const space = embeddingSpace(embed.model, embed.dimensions);
      await indexer(embed, client)(job(m.id, run, "embed"));
      expect(client.calls).toEqual([]);
      expect((await row(m.id)).categories).toEqual(["Quote", "Idea"]);
      expect(
        (await store.staleVectors(space, 500)).map((s) => s.id)
      ).not.toContain(m.id);
    });

    it("an automatic result landing after the edit is dropped", async () => {
      const m = await capture("Lemon tart");
      const store = indexingStore(db);
      const loaded = (await store.load(m.id))!;
      await library().edit(m.id, { categories: ["Place"] });
      expect(
        await store.writeCategories(
          { ...loaded, memoryId: m.id },
          loaded.revision,
          ["Article"]
        )
      ).toBe(false);
      expect((await row(m.id)).categories).toEqual(["Place"]);
    });
  });

  it("categorises every unlocked Memory again when the categoriser's version changes", async () => {
    const auto = await capture("Lemon tart");
    const chosen = await capture("Lemon tart");
    const embed = embedder();
    await indexer(embed)(job(auto.id, 1));
    await indexer(embed)(job(chosen.id, 1));
    await library().edit(chosen.id, { categories: ["Quote"] });
    expect(await row(auto.id)).toMatchObject({
      categoriesVersion: CATEGORISING.version,
    });
    const space = embeddingSpace(embed.model, embed.dimensions);
    const store = indexingStore(db);
    const due = async () =>
      (await store.staleVectors(space, 500)).map((s) => s.id);
    expect(await due()).not.toContain(auto.id);

    // An older categoriser made them: the thresholds or prototypes changed since.
    await db
      .update(schema.memory)
      .set({ categoriesVersion: CATEGORISING.version - 1 })
      .where(inArray(schema.memory.id, [auto.id, chosen.id]));
    expect(await due()).toContain(auto.id);
    expect(await due()).not.toContain(chosen.id);

    embed.texts.length = 0;
    await indexer(embed, jev({ Tutorial: 0.7 }))(job(auto.id, 1, "embed"));
    expect(embed.texts.some((t) => /lemon/i.test(t))).toBe(false);
    expect(await row(auto.id)).toMatchObject({
      categories: ["Tutorial"],
      categoriesVersion: CATEGORISING.version,
    });
    expect(await due()).not.toContain(auto.id);
    expect((await row(chosen.id)).categories).toEqual(["Quote"]);
  });

  describe("as a search filter", () => {
    const names = (results: { id: string }[]) => results.map((r) => r.id);
    // A Library of its own, so other tests' Categories stay out of the counts.
    let mine: ReturnType<typeof openLibrary>;
    beforeEach(async () => {
      const id = await newUser(db);
      others.push(id);
      mine = openLibrary(db, id);
    });
    const save = async (body: string, categories: Category[]) => {
      const saved = await mine.capture({ body });
      if (!("memory" in saved)) throw new Error("capture");
      await mine.edit(saved.memory.id, { categories });
      return saved.memory.id;
    };

    it("narrows words and browsing before any limit, with a why", async () => {
      const tart = await save("Lemon tart notes", ["Recipe"]);
      const bread = await save("Sourdough bread notes", ["Recipe", "Tutorial"]);
      const trip = await save("Lisbon trip notes", ["Place"]);
      const only = (...categories: string[]) => ({ filters: { categories } });
      expect(names(await mine.search("notes", only("Recipe")))).toEqual(
        expect.arrayContaining([tart, bread])
      );
      expect(names(await mine.search("notes", only("Recipe")))).not.toContain(
        trip
      );
      // A limit of one cannot cut a matching Memory off behind a non-matching one.
      expect(
        names(await mine.search("notes", { ...only("Place"), limit: 1 }))
      ).toEqual([trip]);
      // No words: a browse, newest first, saying which Category it matched.
      const browse = await mine.search("", only("Tutorial", "Place"));
      expect(names(browse).slice(0, 2)).toEqual([trip, bread]);
      expect(browse.find((r) => r.id === bread)?.part).toMatchObject({
        kind: "filter",
        field: "category",
        value: "Tutorial",
      });
      expect(names(await mine.search("", only("Quote")))).toEqual([]);
    });

    it("pages a browse by cursor, and combines with a kind", async () => {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await save(`Page ${i}`, ["Idea"]));
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 6; page++) {
        const got = names(
          await mine.search("", {
            filters: { categories: ["Idea"] },
            limit: 2,
            ...(cursor && { cursor }),
          })
        );
        if (!got.length) break;
        seen.push(...got);
        cursor = got.at(-1);
      }
      expect(seen).toEqual(expect.arrayContaining(ids));
      expect(new Set(seen).size).toBe(seen.length);
      expect(
        await mine.search("", {
          kinds: ["image"],
          filters: { categories: ["Idea"] },
        })
      ).toEqual([]);
    });
  });

  it("takes back what a model decided on AI opt-out, keeps a user's choice, and categorises again after", async () => {
    const auto = await capture("Lemon tart");
    const chosen = await capture("Lemon tart");
    const embed = embedder();
    await indexer(embed)(job(auto.id, 1));
    await indexer(embed)(job(chosen.id, 1));
    await library().edit(chosen.id, { categories: ["Quote"] });
    expect((await row(auto.id)).categories).toEqual(["Recipe"]);

    await library().setAiOptOut(auto.id, true);
    await library().setAiOptOut(chosen.id, true);
    expect(await row(auto.id)).toMatchObject({
      categories: ["Other"],
      categoriesRevision: null,
    });
    expect(await row(chosen.id)).toMatchObject({
      categories: ["Quote"],
      locked: true,
    });

    await library().setAiOptOut(auto.id, false);
    await indexer(embed)(job(auto.id, (await row(auto.id)).run));
    expect((await row(auto.id)).categories).toEqual(["Recipe"]);
  });

  it("does not count an absent field as a text change", async () => {
    const m = await capture("Lemon tart");
    const edited = await library().edit(m.id, {
      categories: ["Idea"],
      title: undefined,
    });
    expect(edited).toMatchObject({ revision: m.revision });
  });

  it("finishes Indexing even when keeping the Categories fails", async () => {
    const m = await capture("Lemon tart");
    const real = indexingStore(db);
    const failing = {
      ...real,
      writeCategories: async () => {
        throw new Error("database away");
      },
    } as typeof real;
    expect(await indexer(embedder(), undefined, failing)(job(m.id, 1))).toEqual(
      { result: "searchable" }
    );
    expect((await row(m.id)).categoriesRevision).toBeNull();
  });

  it("recategorises an unlocked Memory when its text changes", async () => {
    const m = await capture("Lemon tart");
    const embed = embedder();
    await indexer(embed)(job(m.id, 1));
    expect((await row(m.id)).categories).toEqual(["Recipe"]);
    await library().edit(m.id, { body: "A new video" });
    const { run } = await row(m.id);
    const next: Provider = {
      ...provider(),
      async extract() {
        return {
          text: JSON.stringify(found({ description: "a video to watch" })),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    await createIndexer({
      store: indexingStore(db),
      providers: [next],
      embedder: embed,
      readFile: async () => undefined,
    }).index(job(m.id, run));
    expect(await row(m.id)).toMatchObject({
      categories: ["Video"],
      categoriesRevision: 2,
    });
  });
});
