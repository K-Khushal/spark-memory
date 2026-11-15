import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
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
  openCategories,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";
import { categoryStore } from "./category-store";

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
      store: categoryStore(db),
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
      const store = categoryStore(db);
      await a.categories.remove(garden.id);
      const claim = {
        memoryId: m.id,
        userId: a.id,
        generation: m.indexGeneration,
        run: 1,
      };
      await expect(
        store.writeCategories(
          claim,
          m.revision,
          ["Gardening"],
          await generationOf(a.id)
        )
      ).rejects.toThrow();
      expect((await a.row(m.id)).categories).toEqual(["Other"]);
    });

    /** The generation of the person's Categories a worker would have loaded. */
    const generationOf = async (userId: string) =>
      (
        await db
          .select({ g: schema.categoryRun.generation })
          .from(schema.categoryRun)
          .where(eq(schema.categoryRun.userId, userId))
      )[0]?.g ?? 0;
    const claimOf = (
      p: Awaited<ReturnType<typeof person>>,
      m: { id: string; indexGeneration: string }
    ) => ({
      memoryId: m.id,
      userId: p.id,
      generation: m.indexGeneration,
      run: 1,
    });
    /** What a settled promise came to: "ok", or the Postgres error code (40P01 is a deadlock). */
    const outcome = async (work: Promise<unknown>) => {
      try {
        await work;
        return "ok";
      } catch (error) {
        for (
          let e = error as { code?: string; cause?: unknown } | undefined,
            i = 0;
          e && i < 5;
          i++
        ) {
          if (e.code) return e.code;
          e = e.cause as typeof e;
        }
        return "error";
      }
    };
    /** Until some other statement on Memories is waiting for a lock (or a moment has passed). */
    const untilLockWait = async () => {
      for (let i = 0; i < 40; i++) {
        const { rows } = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity
              where wait_event_type = 'Lock' and pid <> pg_backend_pid()
                and datname = current_database()`
        );
        if (rows[0]!.n > 0) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    describe("lock order", () => {
      /**
       * A write holds its Memory and then (the trigger) needs the Category;
       * the Category's owner must never hold the Category while waiting for
       * that Memory. Deterministic: the write takes the Memory first, the
       * edit starts, and only then does the write need the Category.
       */
      const probe = async (
        edit: (
          p: Awaited<ReturnType<typeof person>>,
          id: string
        ) => Promise<unknown>
      ) => {
        const a = await person();
        const garden = await a.create("Gardening");
        const m = await a.capture("Tomatoes");
        await a.library.edit(m.id, { categories: ["Gardening"] });
        let editing: Promise<string> | undefined;
        const writing = outcome(
          db.transaction(async (tx) => {
            await tx.execute(
              sql`select 1 from memory where id = ${m.id} for update`
            );
            editing = outcome(edit(a, garden.id));
            await untilLockWait();
            await tx
              .update(schema.memory)
              .set({ categories: ["Gardening", "Recipe"] })
              .where(eq(schema.memory.id, m.id));
          })
        );
        return { a, m, writing: await writing, editing: await editing! };
      };

      it("deleting a Category and a write to a Memory that has it never deadlock", async () => {
        const { a, m, writing, editing } = await probe((p, id) =>
          p.categories.remove(id)
        );
        expect({ writing, editing }).toEqual({ writing: "ok", editing: "ok" });
        expect((await a.row(m.id)).categories).toEqual(["Recipe"]);
      });

      it("renaming a Category and a write to a Memory that has it never deadlock", async () => {
        const { a, m, writing, editing } = await probe((p, id) =>
          p.categories.rename(id, "Plant Care")
        );
        expect({ writing, editing }).toEqual({ writing: "ok", editing: "ok" });
        expect((await a.row(m.id)).categories).toEqual([
          "Plant Care",
          "Recipe",
        ]);
      });

      /**
       * A Memory holds the edit up (the first); meanwhile two others get the
       * Category, one is held by a writer of something else and one is being
       * written. The edit's first look at who has the Category was before
       * they did, so a design that locked "the Memories that have it" up
       * front misses them.
       */
      it("a Memory that gets the Category after the edit began, and is being written, cannot deadlock it", async () => {
        const a = await person();
        const garden = await a.create("Gardening");
        const first = await a.capture("one");
        const held = await a.capture("two");
        const written = await a.capture("three");
        await a.library.edit(first.id, { categories: ["Gardening"] });
        /** A transaction that holds one Memory's row until released. */
        const hold = (id: string) => {
          let release!: () => void;
          const gate = new Promise<void>((resolve) => (release = resolve));
          let ready!: () => void;
          const locked = new Promise<void>((resolve) => (ready = resolve));
          const done = db.transaction(async (tx) => {
            await tx.execute(
              sql`select 1 from memory where id = ${id} for update`
            );
            ready();
            await gate;
          });
          return { locked, release, done };
        };
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

        const blocker = hold(first.id);
        await blocker.locked;
        const edit = outcome(a.categories.rename(garden.id, "Plant Care"));
        await untilLockWait();
        // They get the Category now (or, once edits are serialised, as soon as they can).
        // One after the other, so the held Memory is the first the edit meets.
        const giving = (async () => {
          await a.library.edit(held.id, { categories: ["Gardening"] });
          await a.library.edit(written.id, { categories: ["Gardening"] });
        })();
        const gave = outcome(giving);
        await Promise.race([giving.catch(() => {}), wait(700)]);
        // The edit meets Memories in the order they sit on disk: it is held up
        // by the first, and the second is the one being written.
        const { rows: order } = await db.execute<{ id: string }>(
          sql`select id from memory where id in (${held.id}, ${written.id}) order by ctid`
        );
        const [stuck, busy] = order.map((r) => r.id) as [string, string];
        const other = hold(stuck);
        await other.locked;
        blocker.release();
        await blocker.done;
        await wait(400);
        const writing = outcome(
          a.library.edit(busy, { categories: ["Gardening", "Recipe"] })
        );
        await wait(400);
        other.release();
        await other.done;
        expect(await Promise.all([edit, gave, writing])).toEqual([
          "ok",
          "ok",
          "ok",
        ]);
        // Whatever order they ran in, no Memory is left with a name that is not a Category.
        const known = new Set<string>([
          ...CATEGORY_NAMES,
          ...(await a.categories.list()).categories.map((c) => c.name),
        ]);
        for (const m of [first, held, written]) {
          expect(
            (await a.row(m.id)).categories.every((c) => known.has(c))
          ).toBe(true);
        }
      });
    });

    it("a delete racing a write: each ends cleanly, and no Category that does not exist is left", async () => {
      const a = await person();
      const embed = embedder();
      const store = categoryStore(db);
      for (let i = 0; i < 15; i++) {
        const m = await indexed(a, `Garden ${i}`, embed);
        const garden = await a.create("Gardening");
        const [written, removed] = await Promise.all([
          outcome(
            store.writeCategories(
              claimOf(a, m),
              m.revision,
              ["Gardening"],
              await generationOf(a.id)
            )
          ),
          outcome(a.categories.remove(garden.id)),
        ]);
        // The delete always succeeds; the write lands, or is refused as unknown (23514).
        expect(removed).toBe("ok");
        expect(["ok", "23514"]).toContain(written);
        expect((await a.row(m.id)).categories).not.toContain("Gardening");
        await a.library.remove(m.id);
      }
    });

    it("a rename racing a write: each ends cleanly, and the old name is not left behind", async () => {
      const a = await person();
      const embed = embedder();
      const store = categoryStore(db);
      for (let i = 0; i < 15; i++) {
        const m = await indexed(a, `Garden ${i}`, embed);
        const garden = await a.create("Gardening");
        const [written, renamed] = await Promise.all([
          outcome(
            store.writeCategories(
              claimOf(a, m),
              m.revision,
              ["Gardening"],
              await generationOf(a.id)
            )
          ),
          outcome(a.categories.rename(garden.id, "Plant Care")),
        ]);
        expect(renamed).toBe("ok");
        expect(["ok", "23514"]).toContain(written);
        expect((await a.row(m.id)).categories).not.toContain("Gardening");
        await a.categories.remove(garden.id);
        await a.library.remove(m.id);
      }
    });

    it("a Category created while a Memory is being categorised is not lost", async () => {
      const a = await person();
      const embed = embedder();
      const m = await indexed(a, "My garden in June", embed);
      await a.create("Gardening");
      // The worker has its list ("Gardening"); while Jev answers, the person
      // creates a second Category.
      const asked: (readonly string[])[] = [];
      const jev: CategoryClient = {
        model: "fake-jev",
        async classify(_text, categories) {
          asked.push(categories);
          if (asked.length === 1) await a.create("Cat Photos");
          return {
            scores: { Gardening: 0.6, "Cat Photos": 0.4 },
            inputTokens: 100,
          };
        },
      };
      await indexer(embed, jev)(job(m.id, "embed"));
      expect(asked[0]).toEqual([...CATEGORY_NAMES, "Gardening"]);
      // Its answer was made without the new Category: refused, and the Memory is still due.
      expect((await a.row(m.id)).categories).toEqual(["Other"]);
      expect((await a.categories.due(10)).map((d) => d.id)).toContain(m.id);
      // Another go, with both names, finishes it.
      await indexer(embed, jev)(job(m.id, "embed"));
      expect(asked[1]).toEqual([...CATEGORY_NAMES, "Gardening", "Cat Photos"]);
      expect((await a.row(m.id)).categories).toEqual([
        "Gardening",
        "Cat Photos",
      ]);
      expect((await a.categories.due(10)).map((d) => d.id)).not.toContain(m.id);
    });
  });
});
