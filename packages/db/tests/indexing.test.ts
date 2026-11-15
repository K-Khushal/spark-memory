import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { IndexingOutput } from "@spark/core";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Indexing's writes against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

const found = (over: Partial<IndexingOutput> = {}): IndexingOutput => ({
  title: "Citrus dessert",
  description: "A pastry with a glossy zesty filling",
  ocrText: "Bake at 180 degrees",
  entities: ["Ottolenghi"],
  tags: ["baking"],
  language: "en",
  ...over,
});

describe.skipIf(!databaseUrl)("Indexing", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ana: string;

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ana = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, ana);
    await close();
  });

  const library = () => openLibrary(db, ana);
  const store = () => indexingStore(db);
  const capture = async (body: string) => {
    const result = await library().capture({ body });
    if (!("memory" in result)) throw new Error("conflict");
    return result.memory;
  };
  /** The Claim on a Memory as its row is now, at `run` (else its current run). */
  const claimOf = async (memoryId: string, run?: number) => {
    const [row] = await db
      .select({
        userId: schema.memory.userId,
        generation: schema.memory.indexGeneration,
        run: schema.memory.indexRun,
      })
      .from(schema.memory)
      .where(eq(schema.memory.id, memoryId));
    return { memoryId, ...row!, ...(run !== undefined && { run }) };
  };
  const runOf = async (id: string) =>
    (
      await db
        .select({ run: schema.memory.indexRun })
        .from(schema.memory)
        .where(eq(schema.memory.id, id))
    )[0]!.run;
  const ids = async (query: string) =>
    (await library().search(query)).map((m) => m.id);
  const extraction = (over?: Partial<IndexingOutput>) => ({
    output: found(over),
    model: "fake",
  });

  it("loads a Memory waiting for Indexing at its current run", async () => {
    const memory = await capture("Lemon tart with a short crust");
    expect(await store().load(memory.id)).toMatchObject({
      userId: ana,
      kind: "text",
      run: 1,
      body: "Lemon tart with a short crust",
      aiOptOut: false,
    });
  });

  it("leases a Memory to one delivery at a time, at the run it was sent for", async () => {
    const memory = await capture("Delivered twice at once");
    const [first, second] = await Promise.all([
      store().load(memory.id, 1),
      store().load(memory.id, 1),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await store().load(memory.id)).toBeUndefined();
    await store().release(await claimOf(memory.id, 1));
    expect(await store().load(memory.id, 2)).toBeUndefined();
    expect(await store().load(memory.id, 1)).toMatchObject({ run: 1 });
    expect(await store().isCurrent(await claimOf(memory.id, 1))).toBe(true);
    await library().setAiOptOut(memory.id, true);
    expect(await store().isCurrent(await claimOf(memory.id, 1))).toBe(false);
  });

  it("never lets a lease on an old run hold up a new one", async () => {
    const edited = await capture("Typo in thsi");
    expect(await store().load(edited.id, 1)).toBeDefined();
    // Fixing the typo while the first run is out starts run 2, at once.
    await library().edit(edited.id, { body: "Typo in this" });
    expect(await store().load(edited.id, 2)).toMatchObject({ run: 2 });

    const flipped = await capture("Opt out and back in");
    expect(await store().load(flipped.id, 1)).toBeDefined();
    await library().setAiOptOut(flipped.id, true);
    await library().setAiOptOut(flipped.id, false);
    expect(await store().load(flipped.id, 3)).toMatchObject({ run: 3 });
  });

  it("keeps the lease while the delivery that holds it is still working", async () => {
    const memory = await capture("Long chain");
    await store().load(memory.id, 1);
    await db
      .update(schema.memory)
      .set({ indexLeaseUntil: sql`now() + interval '1 second'` })
      .where(eq(schema.memory.id, memory.id));
    // Each provider call checks the run, and extends the lease.
    expect(await store().isCurrent(await claimOf(memory.id, 1))).toBe(true);
    await new Promise((done) => setTimeout(done, 1100));
    expect(await store().load(memory.id, 1)).toBeUndefined();
  });

  it("puts edits in the background, and Retry or opt-in first in line once a day", async () => {
    const priority = async (id: string) =>
      (
        await db
          .select({ p: schema.memory.indexPriority })
          .from(schema.memory)
          .where(eq(schema.memory.id, id))
      )[0]!.p;
    const memory = await capture("Priorities");
    expect(await priority(memory.id)).toBe("fresh");
    // Fixing a typo before the first run finished keeps it first in line.
    await library().edit(memory.id, { body: "Priorities, fixed" });
    expect(await priority(memory.id)).toBe("fresh");
    await store().complete(await claimOf(memory.id, 2), extraction());
    // Once Searchable, editing is background work.
    await library().edit(memory.id, { body: "Priorities, edited" });
    expect(await priority(memory.id)).toBe("background");
    for (const expected of ["fresh", "background"]) {
      await store().fail(await claimOf(memory.id), "unavailable");
      await library().retryIndexing(memory.id);
      expect(await priority(memory.id)).toBe(expected);
    }
    await library().setAiOptOut(memory.id, true);
    await library().setAiOptOut(memory.id, false);
    expect(await priority(memory.id)).toBe("background");
  });

  it("makes what Indexing found searchable, by keyword and typo, and names an image", async () => {
    const memory = await capture("Lemon tart with a short crust");
    expect(await ids("zesty")).not.toContain(memory.id);
    expect(
      await store().complete(await claimOf(memory.id, 1), extraction())
    ).toBe(true);
    for (const query of [
      "zesty",
      "Ottolenghi",
      "baking",
      "degrees",
      "zestyy",
    ]) {
      expect(await ids(query), query).toContain(memory.id);
    }
    expect(await library().get(memory.id)).toMatchObject({
      indexState: "searchable",
      indexTitle: "Citrus dessert",
    });
    // Once Searchable, the store has nothing more to do with it.
    expect(await store().load(memory.id)).toBeUndefined();
  });

  it("indexes in the detected language and still matches words as written", async () => {
    const memory = await capture("Les maisons anciennes de Lyon");
    await store().complete(
      await claimOf(memory.id, 1),
      extraction({ description: "Photographies de maisons", language: "fr" })
    );
    const [row] = await db
      .select({ tsv: sql<string>`${schema.memory.searchTsv}::text` })
      .from(schema.memory)
      .where(eq(schema.memory.id, memory.id));
    // French stemming ("maison", "ancien") and the words as written.
    expect(row!.tsv).toContain("'maison'");
    expect(row!.tsv).toContain("'ancien'");
    expect(row!.tsv).toContain("'maisons'");
    expect(await ids("maisons")).toContain(memory.id);
    expect(await ids("anciennes")).toContain(memory.id);
  });

  it("maps languages to text search configurations, simple when Postgres has none", async () => {
    const config = async (tag: string | null) =>
      (
        await db.execute<{ c: string }>(
          sql`select search_config(${tag})::text as c`
        )
      ).rows[0]!.c;
    expect(await config(null)).toBe("english");
    expect(await config("pt-BR")).toBe("portuguese");
    expect(await config("nb")).toBe("norwegian");
    expect(await config("ja")).toBe("simple");
    expect(await config("und")).toBe("simple");
  });

  it("writes nothing for a run that has moved on, or twice", async () => {
    const memory = await capture("Run one");
    await library().edit(memory.id, { body: "Run two" });
    expect(
      await store().complete(await claimOf(memory.id, 1), extraction())
    ).toBe(false);
    expect(await store().fail(await claimOf(memory.id, 1), "unavailable")).toBe(
      false
    );
    expect(
      await store().complete(await claimOf(memory.id, 2), extraction())
    ).toBe(true);
    expect(
      await store().complete(await claimOf(memory.id, 2), extraction())
    ).toBe(false);
    expect(await store().fail(await claimOf(memory.id, 2), "unavailable")).toBe(
      false
    );
    expect(await library().get(memory.id)).toMatchObject({
      indexState: "searchable",
    });
  });

  it("restarts Indexing when the text changes, not for a title or the same text", async () => {
    const memory = await capture("Original text");
    await store().complete(await claimOf(memory.id, 1), extraction());
    const titled = await library().edit(memory.id, { title: "Named" });
    expect(titled).toMatchObject({ indexState: "searchable" });
    const same = await library().edit(memory.id, { body: "Original text" });
    expect(same).toMatchObject({ indexState: "searchable" });
    const changed = await library().edit(memory.id, { body: "New text" });
    expect(changed).toMatchObject({ indexState: "indexing" });
    expect(await runOf(memory.id)).toBe(2);
  });

  it("fails with a reason, and Retry starts a new run", async () => {
    const memory = await capture("Will fail");
    expect(await store().fail(await claimOf(memory.id, 1), "unavailable")).toBe(
      true
    );
    expect(await library().get(memory.id)).toMatchObject({
      indexState: "failed",
      indexError: "unavailable",
    });
    expect(await library().retryIndexing(memory.id)).toMatchObject({
      indexState: "indexing",
      indexError: null,
    });
    expect(await runOf(memory.id)).toBe(2);
    // Retry on a Memory that has not failed changes nothing.
    await library().retryIndexing(memory.id);
    expect(await runOf(memory.id)).toBe(2);
  });

  describe("AI opt-out", () => {
    it("forgets what Indexing found, keeps its own words, and is Searchable at once", async () => {
      const memory = await capture("Private bank statement");
      await store().complete(await claimOf(memory.id, 1), extraction());
      const opted = await library().setAiOptOut(memory.id, true);
      expect(opted).toMatchObject({
        aiOptOut: true,
        indexState: "searchable",
        indexTitle: null,
      });
      expect(await ids("zesty")).not.toContain(memory.id);
      expect(await ids("zestyy")).not.toContain(memory.id);
      expect(await ids("statement")).toContain(memory.id);
      const rows = await db
        .select()
        .from(schema.memoryIndex)
        .where(eq(schema.memoryIndex.memoryId, memory.id));
      expect(rows).toEqual([]);
      // Editing its text never restarts Indexing.
      expect(
        await library().edit(memory.id, { body: "Private bank statement 2" })
      ).toMatchObject({ indexState: "searchable" });
    });

    it("drops a result that lands after it was switched on mid-flight", async () => {
      const memory = await capture("Flip me");
      const loaded = await store().load(memory.id);
      await library().setAiOptOut(memory.id, true);
      expect(
        await store().complete(
          { ...loaded!, memoryId: memory.id },
          extraction()
        )
      ).toBe(false);
      expect(await ids("zesty")).not.toContain(memory.id);
    });

    it("switched off, Indexes again as a new run", async () => {
      const memory = await capture("Opt back in");
      await library().setAiOptOut(memory.id, true);
      expect(await library().setAiOptOut(memory.id, false)).toMatchObject({
        aiOptOut: false,
        indexState: "indexing",
      });
      expect(await store().load(memory.id)).toMatchObject({
        run: 3,
        aiOptOut: false,
      });
    });
  });

  it("treats rows from before Indexing as background, and every Capture as fresh", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.memory).values({ id, userId: ana, kind: "text" });
    const image = await library().captureImage({
      id: crypto.randomUUID(),
      mime: "image/png",
      bytes: 10,
      width: 1,
      height: 1,
      contentHash: "ab".repeat(32),
      thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
      thumbnail: { mime: "image/webp", bytes: 5 },
    });
    const text = await capture("Fresh");
    const rows = await db
      .select({ id: schema.memory.id, p: schema.memory.indexPriority })
      .from(schema.memory)
      .where(
        sql`${schema.memory.id} in (${id}, ${"memory" in image ? image.memory.id : ""}, ${text.id})`
      );
    const of = (x: string) => rows.find((r) => r.id === x)!.p;
    expect(of(id)).toBe("background");
    expect(of("memory" in image ? image.memory.id : "")).toBe("fresh");
    expect(of(text.id)).toBe("fresh");
  });

  it("keeps an estimated call apart from a measured one", async () => {
    const memory = await capture("Timed out");
    await store().recordCall({
      userId: ana,
      memoryId: memory.id,
      provider: "workers-ai",
      model: "m",
      usage: { inputTokens: 100, outputTokens: 4096 },
      costMicros: 3,
      estimated: true,
    });
    const [row] = await db
      .select({ estimated: schema.aiCall.estimated })
      .from(schema.aiCall)
      .where(eq(schema.aiCall.memoryId, memory.id));
    expect(row!.estimated).toBe(true);
  });

  it("reconciles a reserved provider receipt without counting its cost twice", async () => {
    const before = await store().spentTodayMicros();
    const id = crypto.randomUUID();
    const call = {
      id,
      userId: ana,
      memoryId: null,
      provider: "jev" as const,
      model: "jev-1.14.0",
      usage: { inputTokens: 1000, outputTokens: 0 },
      costMicros: 42,
    };
    await store().recordCall({ ...call, estimated: true });
    await store().recordCall({ ...call, costMicros: 21, estimated: false });
    await store().recordCall({ ...call, costMicros: 21, estimated: false });
    const rows = await db
      .select()
      .from(schema.aiCall)
      .where(eq(schema.aiCall.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ costMicros: 21, estimated: false });
    expect((await store().spentTodayMicros()) - before).toBe(21);
  });

  it("adds up AI spend per day atomically, and keeps each call per Memory", async () => {
    const before = await store().spentTodayMicros();
    const memory = await capture("Costly");
    await Promise.all(
      Array.from({ length: 40 }, () =>
        store().recordCall({
          userId: ana,
          memoryId: memory.id,
          provider: "fake",
          model: "fake",
          usage: { inputTokens: 10, outputTokens: 5 },
          costMicros: 7,
        })
      )
    );
    expect((await store().spentTodayMicros()) - before).toBeGreaterThanOrEqual(
      280
    );
    const calls = await db
      .select({ total: sql<string>`sum(${schema.aiCall.costMicros})` })
      .from(schema.aiCall)
      .where(eq(schema.aiCall.memoryId, memory.id));
    expect(Number(calls[0]!.total)).toBe(280);
  });

  it("finds Memories stuck Indexing, to enqueue them again", async () => {
    const memory = await capture("Lost message");
    const stalled = async () => (await store().stalled()).map((m) => m.id);
    expect(await stalled()).not.toContain(memory.id);
    await db
      .update(schema.memory)
      .set({ updatedAt: sql`now() - interval '2 hours'` })
      .where(eq(schema.memory.id, memory.id));
    expect(await store().stalled()).toContainEqual({
      id: memory.id,
      run: 1,
      generation: memory.indexGeneration,
      priority: "fresh",
    });
  });
});
