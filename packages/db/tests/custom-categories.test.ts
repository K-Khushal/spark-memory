import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CATEGORISING,
  CATEGORY_NAMES,
  MAX_CUSTOM_CATEGORIES,
  prototypeOf,
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
  openCategories,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

const url = process.env.DATABASE_URL;

/**
 * One axis per built-in Category and one for each custom name the test
 * knows; a Memory's text points at the axis of the kind it mentions.
 */
const CUSTOM = ["Gardening", "Cat Photos"];
const AXES = [...CATEGORY_NAMES, ...CUSTOM];
function embedder(): Embedder & { texts: string[] } {
  const texts: string[] = [];
  const axis = (name: string) => {
    const v = new Array<number>(AXES.length).fill(0);
    v[AXES.indexOf(name)] = 1;
    return v;
  };
  return {
    name: "fake",
    model: "custom-categories-embedding",
    dimensions: AXES.length,
    texts,
    async embed(inputs) {
      const vectors = inputs.map((input) => {
        const text = "text" in input ? input.text : "";
        texts.push(text);
        const proto = AXES.find((n) => prototypeOf(n) === text);
        if (proto) return axis(proto);
        if (/garden/i.test(text)) return axis("Gardening");
        if (/recipe/i.test(text)) return axis("Recipe");
        return new Array<number>(AXES.length).fill(0);
      });
      return { vectors, usage: { textTokens: 10, imageTokens: 0 } };
    },
  };
}

const found = (text: string): IndexingOutput => ({
  title: text,
  description: text,
  ocrText: "",
  entities: [],
  tags: [],
  language: "en",
});
const provider = (): Provider => ({
  name: "fake",
  model: "fake",
  async extract(request) {
    return {
      text: JSON.stringify(found(request.user)),
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
});

describe.skipIf(!url)("Custom Categories", () => {
  let db: Database;
  let close: () => Promise<void>;
  const users: string[] = [];
  beforeAll(async () => {
    ({ db, close } = openDatabase(url!));
  });
  afterAll(async () => {
    for (const id of users) await removeUser(db, id);
    await close();
  });

  /** A person with an empty Library, so counts and sweeps are theirs alone. */
  const person = async () => {
    const id = await newUser(db);
    users.push(id);
    const library = openLibrary(db, id);
    const categories = openCategories(db, id);
    const capture = async (body: string) => {
      const saved = await library.capture({ body });
      if (!("memory" in saved)) throw new Error("capture");
      return saved.memory;
    };
    const row = async (memoryId: string) =>
      (
        await db
          .select({
            categories: schema.memory.categories,
            locked: schema.memory.categoriesLocked,
            version: schema.memory.categoriesVersion,
          })
          .from(schema.memory)
          .where(eq(schema.memory.id, memoryId))
      )[0]!;
    const create = async (name: string) => {
      const made = await categories.create(name);
      if (!("category" in made)) throw new Error(`create ${name}`);
      return made.category;
    };
    return { id, library, categories, capture, row, create };
  };

  const indexer = (embed: Embedder, jev?: CategoryClient) =>
    createIndexer({
      store: indexingStore(db),
      providers: [provider()],
      embedder: embed,
      ...(jev && { jev }),
      readFile: async () => undefined,
    }).index;
  const job = (
    memoryId: string,
    task: "index" | "embed" = "index",
    run = 1
  ) => ({
    memoryId,
    run,
    priority: "background" as const,
    attempt: 1,
    task,
  });
  const names = async (p: { categories: { list(): Promise<unknown> } }) =>
    (
      (await p.categories.list()) as { categories: { name: string }[] }
    ).categories.map((c) => c.name);

  describe("create, rename, delete", () => {
    it("creates a Category, counted and listed by its owner only", async () => {
      const a = await person();
      const b = await person();
      const made = await a.categories.create("  Gardening ");
      expect(made).toMatchObject({ category: { name: "Gardening" } });
      expect(await names(a)).toEqual(["Gardening"]);
      expect(await names(b)).toEqual([]);
      // The same name is free for someone else, and their Memories are not counted.
      const theirs = await b.capture("Tomatoes");
      await b.create("Gardening");
      await b.library.edit(theirs.id, { categories: ["Gardening"] });
      expect((await a.categories.list()).categories).toMatchObject([
        { name: "Gardening", memories: 0 },
      ]);
      expect((await b.categories.list()).categories).toMatchObject([
        { name: "Gardening", memories: 1 },
      ]);
    });

    it("refuses bad, duplicate and too many names", async () => {
      const a = await person();
      await a.create("Gardening");
      const problem = async (name: string) =>
        (await a.categories.create(name)) as { problem?: string };
      expect(await problem("gardening")).toEqual({ problem: "duplicate" });
      expect(await problem("RECIPE")).toEqual({ problem: "duplicate" });
      expect(await problem("home lab")).toEqual({ problem: "case" });
      expect(await problem(" ")).toEqual({ problem: "empty" });
      for (let i = 1; i < MAX_CUSTOM_CATEGORIES; i++)
        await a.create(`Box ${i}`);
      expect(await problem("One More")).toEqual({ problem: "limit" });
    });

    it("lets a Memory take the owner's own Category and no one else's", async () => {
      const a = await person();
      const b = await person();
      await a.create("Gardening");
      const m = await a.capture("Tomatoes");
      expect(
        await a.library.edit(m.id, { categories: ["Gardening", "Recipe"] })
      ).toMatchObject({
        categories: ["Gardening", "Recipe"],
        categoriesLocked: true,
      });
      const theirs = await b.capture("Tomatoes");
      expect(
        await b.library.edit(theirs.id, { categories: ["Gardening"] })
      ).toEqual({ unknownCategory: true });
      expect((await b.row(theirs.id)).categories).toEqual(["Other"]);
      // The rule holds below the Library too.
      await expect(
        db
          .update(schema.memory)
          .set({ categories: ["Gardening"] })
          .where(eq(schema.memory.id, theirs.id))
      ).rejects.toThrow();
    });

    it("renames it on every Memory that has it, locked or not", async () => {
      const a = await person();
      const b = await person();
      const garden = await a.create("Gardening");
      await b.create("Gardening");
      const locked = await a.capture("one");
      const auto = await a.capture("two");
      const untouched = await a.capture("three");
      await a.library.edit(locked.id, { categories: ["Recipe", "Gardening"] });
      await db
        .update(schema.memory)
        .set({ categories: ["Gardening"] })
        .where(eq(schema.memory.id, auto.id));
      const others = await b.capture("four");
      await b.library.edit(others.id, { categories: ["Gardening"] });

      expect(await a.categories.rename(garden.id, "Plant Care")).toMatchObject({
        category: { name: "Plant Care", memories: 2 },
      });
      expect(await a.row(locked.id)).toMatchObject({
        categories: ["Recipe", "Plant Care"],
        locked: true,
      });
      expect(await a.row(auto.id)).toMatchObject({
        categories: ["Plant Care"],
        locked: false,
      });
      expect((await a.row(untouched.id)).categories).toEqual(["Other"]);
      expect((await b.row(others.id)).categories).toEqual(["Gardening"]);
      expect(await names(a)).toEqual(["Plant Care"]);
    });

    it("refuses a rename onto a taken name, and another person's Category", async () => {
      const a = await person();
      const b = await person();
      const garden = await a.create("Gardening");
      await a.create("Cat Photos");
      expect(await a.categories.rename(garden.id, "cat photos")).toEqual({
        problem: "duplicate",
      });
      expect(await a.categories.rename(garden.id, "Recipe")).toEqual({
        problem: "duplicate",
      });
      // A change of case alone is a rename.
      expect(await a.categories.rename(garden.id, "GARDENING")).toMatchObject({
        category: { name: "GARDENING" },
      });
      expect(await b.categories.rename(garden.id, "Mine Now")).toBeUndefined();
      expect(await b.categories.remove(garden.id)).toBeUndefined();
      expect(await names(a)).toContain("GARDENING");
    });

    it("deletes it from Memories and never a Memory; none left means Other", async () => {
      const a = await person();
      const garden = await a.create("Gardening");
      const both = await a.capture("one");
      const only = await a.capture("two");
      const locked = await a.capture("three");
      await a.library.edit(both.id, { categories: ["Recipe", "Gardening"] });
      await db
        .update(schema.memory)
        .set({ categories: ["Gardening"] })
        .where(eq(schema.memory.id, only.id));
      await a.library.edit(locked.id, { categories: ["Gardening"] });

      expect(await a.categories.remove(garden.id)).toEqual({ memories: 3 });
      expect(await a.row(both.id)).toMatchObject({
        categories: ["Recipe"],
        locked: true,
      });
      expect(await a.row(only.id)).toMatchObject({
        categories: ["Other"],
        locked: false,
      });
      expect(await a.row(locked.id)).toMatchObject({
        categories: ["Other"],
        locked: true,
      });
      expect(await a.library.get(only.id)).toBeDefined();
      expect(await names(a)).toEqual([]);
      // Gone from filters too: no one can narrow by it any more.
      expect(await a.categories.has("Gardening")).toBe(false);
    });

    it("removes a person's Categories with the person", async () => {
      const a = await person();
      await a.create("Gardening");
      await removeUser(db, a.id);
      users.splice(users.indexOf(a.id), 1);
      expect(
        await db
          .select()
          .from(schema.category)
          .where(eq(schema.category.userId, a.id))
      ).toEqual([]);
    });
  });

  describe("search", () => {
    it("filters by the owner's own Category, and never finds another's", async () => {
      const a = await person();
      const b = await person();
      await a.create("Gardening");
      await b.create("Gardening");
      const mine = await a.capture("Tomatoes");
      const theirs = await b.capture("Tomatoes");
      await a.library.edit(mine.id, { categories: ["Gardening"] });
      await b.library.edit(theirs.id, { categories: ["Gardening"] });
      const only = { filters: { categories: ["Gardening"] } };
      expect((await a.library.search("", only)).map((r) => r.id)).toEqual([
        mine.id,
      ]);
      expect(
        (await a.library.search("tomatoes", only)).map((r) => r.id)
      ).toEqual([mine.id]);
      expect(await a.categories.has("Gardening")).toBe(true);
      expect(await a.categories.has("Recipe")).toBe(true);
      expect(await a.categories.has("Cat Photos")).toBe(false);
    });
  });

  describe("re-categorising", () => {
    /** An indexed, unlocked Memory: Searchable, with its vectors. */
    const indexed = async (
      p: Awaited<ReturnType<typeof person>>,
      body: string,
      embed: Embedder
    ) => {
      const m = await p.capture(body);
      await indexer(embed)(job(m.id));
      return m;
    };

    it("brings the new Category to unlocked Memories only, with progress and cost", async () => {
      const a = await person();
      const embed = embedder();
      const first = await indexed(a, "My garden in June", embed);
      const second = await indexed(a, "Garden tools", embed);
      const recipe = await indexed(a, "Lemon tart recipe", embed);
      const locked = await indexed(a, "Garden at night", embed);
      await a.library.edit(locked.id, { categories: ["Quote"] });
      expect((await a.row(first.id)).categories).toEqual(["Other"]);
      expect(await a.categories.list()).toMatchObject({
        categories: [],
      });
      const lockedBefore = await a.row(locked.id);

      const made = await a.categories.create("Gardening");
      // Locked, and the Memories Indexing has not reached, are not due.
      expect(made).toMatchObject({ recategorising: 3 });
      expect(await a.categories.list()).toMatchObject({
        run: { done: 0, total: 3 },
      });
      const due = await a.categories.due(10);
      expect(due.map((d) => d.id).sort()).toEqual(
        [first.id, second.id, recipe.id].sort()
      );

      embed.texts.length = 0;
      await indexer(embed)(job(first.id, "embed"));
      expect(await a.row(first.id)).toMatchObject({
        categories: ["Gardening"],
        version: CATEGORISING.version,
      });
      expect(await a.categories.list()).toMatchObject({
        run: { done: 1, total: 3 },
      });
      await indexer(embed)(job(second.id, "embed"));
      await indexer(embed)(job(recipe.id, "embed"));
      expect((await a.row(second.id)).categories).toEqual(["Gardening"]);
      // Another Category still applies where it fits.
      expect((await a.row(recipe.id)).categories).toEqual(["Recipe"]);
      expect((await a.categories.list()).run).toBeUndefined();
      // The Memory's own text was not embedded again; the new name was, once.
      expect(embed.texts.filter((t) => /garden/i.test(t))).toEqual([
        prototypeOf("Gardening"),
      ]);

      // Locked Memories are never touched.
      expect(await a.row(locked.id)).toEqual(lockedBefore);
      expect((await a.categories.due(10)).map((d) => d.id)).not.toContain(
        locked.id
      );

      // Its cost is recorded against the Memory it was spent for.
      const calls = await db
        .select()
        .from(schema.aiCall)
        .where(eq(schema.aiCall.memoryId, first.id));
      expect(calls.some((c) => c.provider === "fake")).toBe(true);
    });

    it("sends the owner's own names to Jev along with the built-ins", async () => {
      const a = await person();
      const embed = embedder();
      const m = await indexed(a, "My garden in June", embed);
      await a.create("Gardening");
      const calls: (readonly string[])[] = [];
      const jev: CategoryClient = {
        model: "fake-jev",
        async classify(_text, categories) {
          calls.push(categories);
          return { scores: { Gardening: 0.6, Article: 0.3 }, inputTokens: 100 };
        },
      };
      await indexer(embed, jev)(job(m.id, "embed"));
      expect(calls).toEqual([[...CATEGORY_NAMES, "Gardening"]]);
      expect((await a.row(m.id)).categories).toEqual(["Gardening", "Article"]);
      const jevCalls = (
        await db
          .select()
          .from(schema.aiCall)
          .where(eq(schema.aiCall.memoryId, m.id))
      ).filter((c) => c.provider === "jev");
      expect(jevCalls).toHaveLength(1);
    });

    it("never sends another person's names", async () => {
      const a = await person();
      const b = await person();
      const embed = embedder();
      const m = await indexed(a, "My garden in June", embed);
      await b.create("Cat Photos");
      const calls: (readonly string[])[] = [];
      const jev: CategoryClient = {
        model: "fake-jev",
        async classify(_text, categories) {
          calls.push(categories);
          return { scores: {}, inputTokens: 1 };
        },
      };
      await a.categories.create("Gardening");
      await indexer(embed, jev)(job(m.id, "embed"));
      expect(calls.flat()).not.toContain("Cat Photos");
    });

    it("leaves AI opt-out Memories out of the run", async () => {
      const a = await person();
      const embed = embedder();
      const m = await indexed(a, "My garden in June", embed);
      await a.library.setAiOptOut(m.id, true);
      expect(await a.categories.create("Gardening")).toMatchObject({
        recategorising: 0,
      });
      expect((await a.categories.list()).run).toBeUndefined();
    });

    it("a Category deleted mid-run is never written, and the Memory stays due", async () => {
      const a = await person();
      const embed = embedder();
      const m = await indexed(a, "My garden in June", embed);
      const garden = await a.create("Gardening");
      const store = indexingStore(db);
      await a.categories.remove(garden.id);
      const claim = {
        memoryId: m.id,
        userId: a.id,
        generation: m.indexGeneration,
        run: 1,
      };
      await expect(
        store.writeCategories(claim, m.revision, ["Gardening"])
      ).rejects.toThrow();
      expect((await a.row(m.id)).categories).toEqual(["Other"]);
    });

    it("a delete racing a write never leaves a Category that does not exist", async () => {
      const a = await person();
      const embed = embedder();
      const store = indexingStore(db);
      for (let i = 0; i < 15; i++) {
        const m = await indexed(a, `Garden ${i}`, embed);
        const garden = await a.create("Gardening");
        const claim = {
          memoryId: m.id,
          userId: a.id,
          generation: m.indexGeneration,
          run: 1,
        };
        await Promise.allSettled([
          store.writeCategories(claim, m.revision, ["Gardening"]),
          a.categories.remove(garden.id),
        ]);
        const { categories } = await a.row(m.id);
        expect(categories).not.toContain("Gardening");
        await a.library.remove(m.id);
      }
    });

    it("a rename racing a write never leaves the old name behind", async () => {
      const a = await person();
      const embed = embedder();
      const store = indexingStore(db);
      for (let i = 0; i < 15; i++) {
        const m = await indexed(a, `Garden ${i}`, embed);
        const garden = await a.create("Gardening");
        const claim = {
          memoryId: m.id,
          userId: a.id,
          generation: m.indexGeneration,
          run: 1,
        };
        await Promise.allSettled([
          store.writeCategories(claim, m.revision, ["Gardening"]),
          a.categories.rename(garden.id, "Plant Care"),
        ]);
        const { categories } = await a.row(m.id);
        expect(categories).not.toContain("Gardening");
        await a.categories.remove(garden.id);
        await a.library.remove(m.id);
      }
    });
  });
});
