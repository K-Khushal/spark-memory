import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deepFetchStore,
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Deep fetch state against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;
const ARTICLE = "Basil wants six hours of light and warm soil. ".repeat(10);

describe.skipIf(!databaseUrl)("Deep fetch store", () => {
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
  const store = () => deepFetchStore(db);
  const row = async (id: string) =>
    (await db.select().from(schema.memory).where(eq(schema.memory.id, id)))[0]!;
  const link = async (url: string, userId = ana) => {
    const result = await library(userId).captureLink({ url });
    if (!("memory" in result)) throw new Error("conflict");
    return result.memory;
  };
  /** A link Gather has come back from, as the Indexing store saves it. */
  const gathered = async (
    url: string,
    found: { text: string | null; imageUrl?: string },
    userId = ana
  ) => {
    const memory = await link(url, userId);
    const r = await row(memory.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId: r.userId,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      {
        text: found.text,
        metadata: {
          title: "Sign in",
          ...(found.imageUrl && { imageUrl: found.imageUrl }),
        },
      }
    );
    return r;
  };
  const indexing = (id: string) =>
    db
      .update(schema.memory)
      .set({ indexState: "indexing" })
      .where(eq(schema.memory.id, id));
  const due = (id: string) =>
    db
      .update(schema.memory)
      .set({ deepFetchDueAt: sql`now() - interval '1 second'` })
      .where(eq(schema.memory.id, id));

  it("is wanted once, when Gather came back thin, and never for a good page", async () => {
    const thin = await gathered("https://thin1.test/", { text: null });
    const good = await gathered("https://good1.test/", {
      text: ARTICLE,
      imageUrl: "https://good1.test/a.png",
    });
    expect(await row(thin.id)).toMatchObject({ deepFetchState: "queued" });
    expect(await row(good.id)).toMatchObject({ deepFetchState: null });
    // A page with text and no image is not thin: a missing image alone never asks.
    const plain = await gathered("https://noimage1.test/", { text: ARTICLE });
    expect(await row(plain.id)).toMatchObject({ deepFetchState: null });
    expect((await library().get(thin.id))!.deepFetch).toBe("fetching");
    expect((await library().get(good.id))!.deepFetch).toBeNull();
  });

  it("is not wanted for a Source that was never shown to be public", async () => {
    const memory = await link("https://refused1.test/");
    const r = await row(memory.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId: ana,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      { text: null, metadata: {}, refused: true }
    );
    expect((await row(r.id)).deepFetchState).toBeNull();
  });

  it("counts an attempt when it is taken, so a worker that dies mid-fetch uses it up", async () => {
    const m = await gathered("https://crash1.test/", { text: null });
    const expire = () =>
      db
        .update(schema.memory)
        .set({ deepFetchLeaseUntil: sql`now() - interval '1 second'` })
        .where(eq(schema.memory.id, m.id));
    for (const attempts of [1, 2, 3]) {
      const taken = await store().claim(m.id, m.indexGeneration, 0);
      expect(taken).toMatchObject({ attempts });
      // The worker dies: its lease runs out with no write.
      await expire();
    }
    // All three are used: the next take fails the Memory instead of a fourth try.
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeUndefined();
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "failed",
      deepFetchError: "error",
      deepFetchAttempts: 3,
    });
    expect((await library().get(m.id))!.deepFetch).toBe("failed");
    // The sweep no longer lists it.
    expect((await store().due(500)).map((t) => t.memoryId)).not.toContain(m.id);
    // Try Again starts over with all its attempts.
    await library().retryDeepFetch(m.id);
    expect(await store().claim(m.id, m.indexGeneration, 1)).toMatchObject({
      attempts: 1,
    });
  });

  it("an expired worker cannot settle the row a later lease took", async () => {
    const m = await gathered("https://race1.test/", { text: null });
    const slow = (await store().claim(m.id, m.indexGeneration, 0))!;
    await db
      .update(schema.memory)
      .set({ deepFetchLeaseUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.memory.id, m.id));
    const next = (await store().claim(m.id, m.indexGeneration, 0))!;
    expect(next.claim.token).not.toBe(slow.claim.token);
    // The slow worker finally answers: every kind of write is refused.
    expect(await store().done(slow.claim, { text: ARTICLE })).toBeUndefined();
    expect(
      await store().retry(slow.claim, { delaySeconds: 60, attempt: true })
    ).toBe(false);
    expect(await store().fail(slow.claim, "nothing")).toBe(false);
    expect(await store().unavailable(slow.claim)).toBe(false);
    expect(await store().stop(slow.claim)).toBe(false);
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "running",
      deepFetchAttempts: 2,
      body: null,
    });
    // The current lease's owner settles it.
    expect(await store().done(next.claim, { text: ARTICLE })).toMatchObject({
      reindex: true,
    });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "done",
      body: ARTICLE,
    });
  });

  it("claims a due Memory once, only at its own run and generation", async () => {
    const m = await gathered("https://claim1.test/", { text: null });
    expect(await store().claim(m.id, m.indexGeneration, 1)).toBeUndefined();
    expect(await store().claim(m.id, crypto.randomUUID(), 0)).toBeUndefined();
    const first = await store().claim(m.id, m.indexGeneration, 0);
    expect(first).toMatchObject({ kind: "link", url: "https://claim1.test/" });
    // A duplicate delivery finds it running.
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeUndefined();
    // A lease that ran out lets another consumer take it.
    await db
      .update(schema.memory)
      .set({ deepFetchLeaseUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.memory.id, m.id));
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeDefined();
  });

  it("does not claim one that is not due yet", async () => {
    const m = await gathered("https://later1.test/", { text: null });
    const claim = (await store().claim(m.id, m.indexGeneration, 0))!.claim;
    await store().retry(claim, { delaySeconds: 3600, attempt: true });
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeUndefined();
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 1,
    });
    expect((await library().get(m.id))!.deepFetch).toBe("waiting");
    expect(await store().pending(m.id, m.indexGeneration)).toMatchObject({
      run: 0,
      delaySeconds: expect.any(Number),
    });
    expect(
      (await store().pending(m.id, m.indexGeneration))!.delaySeconds
    ).toBeGreaterThan(3500);
    await due(m.id);
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeDefined();
  });

  it.each([false, true])(
    "clears the lease and token when done (found: %s)",
    async (found) => {
      const m = await gathered(`https://settled-${found}.test/`, {
        text: null,
      });
      const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
      expect((await row(m.id)).deepFetchToken).toBe(claim.token);
      await store().done(claim, found ? { text: ARTICLE } : undefined);
      expect(await row(m.id)).toMatchObject({
        deepFetchState: "done",
        deepFetchLeaseUntil: null,
        deepFetchToken: null,
      });
    }
  );

  it("keeps what it found, Preserves a link with text and starts Indexing over", async () => {
    const m = await gathered("https://found1.test/", { text: null });
    const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
    await db
      .update(schema.memory)
      .set({ indexState: "searchable" })
      .where(eq(schema.memory.id, m.id));
    const done = await store().done(claim, {
      text: ARTICLE,
      metadata: {
        title: "Ignored: the page already had a title",
        description: "From the browser",
      },
    });
    expect(done).toMatchObject({
      reindex: true,
      indexRun: m.indexRun + 1,
      indexPriority: "background",
    });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "done",
      indexState: "indexing",
      preservation: "preserved",
      body: ARTICLE,
      metadata: { title: "Sign in", description: "From the browser" },
    });
    expect((await library().get(m.id))!.deepFetch).toBeNull();
    expect((await library().search("basil")).map((r) => r.id)).toContain(m.id);
    // A second write for the same claim does nothing.
    expect(await store().done(claim, { text: "other" })).toBeUndefined();
  });

  it("keeps a video's transcript, still Reference only", async () => {
    const memory = await link("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    const r = await row(memory.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId: ana,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      {
        text: null,
        metadata: { video: { transcript: [], transcriptState: "unavailable" } },
      }
    );
    expect(await row(r.id)).toMatchObject({ deepFetchState: "queued" });
    const { claim } = (await store().claim(r.id, r.indexGeneration, 0))!;
    await store().done(claim, {
      text: "Plants need sunlight.",
      transcript: [{ seconds: 760, text: "Plants need sunlight." }],
    });
    expect(await library().get(r.id)).toMatchObject({
      preservation: "reference_only",
      body: "Plants need sunlight.",
      video: {
        transcriptState: "available",
        transcript: [{ seconds: 760, text: "Plants need sunlight." }],
      },
    });
  });

  it("keeps a video's duration when its transcript arrives", async () => {
    const memory = await link(
      "https://www.youtube.com/watch?v=ffffffffffff".slice(0, 43)
    );
    const r = await row(memory.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId: ana,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      {
        text: null,
        metadata: {
          video: {
            duration: 754,
            transcript: [],
            transcriptState: "unavailable",
          },
        },
      }
    );
    const taken = (await store().claim(r.id, r.indexGeneration, 0))!;
    await store().done(taken.claim, {
      text: "Hello there.",
      transcript: [{ seconds: 1, text: "Hello there." }],
    });
    expect((await row(r.id)).metadata).toMatchObject({
      video: { duration: 754, transcriptState: "available" },
    });
  });

  it("is never wanted for a video with AI opt-out, and stops when it is switched on", async () => {
    const a = await link("https://www.youtube.com/watch?v=bbbbbbbbbbb");
    await library().setAiOptOut(a.id, true);
    // Switched on while Indexing: the Source is still gathered (no AI reads it).
    await indexing(a.id);
    const r = await row(a.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId: ana,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      {
        text: null,
        metadata: { video: { transcript: [], transcriptState: "unavailable" } },
      }
    );
    expect((await row(a.id)).deepFetchState).toBeNull();
    // A page may be fetched with AI opt-out: no AI reads it.
    const page = await link("https://optout.test/");
    await library().setAiOptOut(page.id, true);
    await indexing(page.id);
    const p = await row(page.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: p.id,
        userId: ana,
        generation: p.indexGeneration,
        run: p.indexRun,
      },
      { text: null, metadata: { title: "x" } }
    );
    expect((await row(page.id)).deepFetchState).toBe("queued");
  });

  it("fails for good, and Try Again starts a new run with all its attempts", async () => {
    const m = await gathered("https://fail1.test/", { text: null });
    const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
    await store().fail(claim, "nothing");
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "failed",
      deepFetchError: "nothing",
      deepFetchAttempts: 1,
    });
    expect((await library().get(m.id))!.deepFetch).toBe("failed");
    // Not the owner: nothing happens.
    expect(await library(ben).retryDeepFetch(m.id)).toBeUndefined();
    const again = await library().retryDeepFetch(m.id);
    expect(again).toMatchObject({ deepFetch: "fetching", deepFetchRun: 1 });
    expect(await row(m.id)).toMatchObject({ deepFetchAttempts: 0 });
    // The old run's message no longer matches.
    expect(await store().claim(m.id, m.indexGeneration, 0)).toBeUndefined();
    expect(await store().claim(m.id, m.indexGeneration, 1)).toBeDefined();
    // Try Again on a Memory that is not Failed changes nothing.
    expect((await library().retryDeepFetch(m.id))!.deepFetchRun).toBe(1);
  });

  it("gives the attempt back when a wait or Unavailable did not use it", async () => {
    const m = await gathered("https://giveback1.test/", { text: null });
    const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
    expect(await row(m.id)).toMatchObject({ deepFetchAttempts: 1 });
    await store().retry(claim, { delaySeconds: 60, attempt: false });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 0,
    });
  });

  it("keeps Unavailable in the database only: nothing shows, and Try Again cannot change it", async () => {
    const m = await gathered("https://unavailable1.test/", { text: null });
    const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
    await store().unavailable(claim);
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "unavailable",
      deepFetchAttempts: 0,
    });
    // An operator state: the person sees nothing, and there is nothing to retry.
    expect((await library().get(m.id))!.deepFetch).toBeNull();
    expect((await library().retryDeepFetch(m.id))!.deepFetchRun).toBe(0);
    expect(await row(m.id)).toMatchObject({ deepFetchState: "unavailable" });
  });

  it("stops cleanly when Deep fetch no longer applies", async () => {
    const m = await gathered("https://stop1.test/", { text: null });
    const { claim } = (await store().claim(m.id, m.indexGeneration, 0))!;
    await store().stop(claim);
    expect((await row(m.id)).deepFetchState).toBeNull();
  });

  it("counts 20 a person a day, and each person apart", async () => {
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      expect(await store().takeSlot(ben, limit)).toBe(true);
    }
    expect(await store().takeSlot(ben, limit)).toBe(false);
    expect(await store().takeSlot(ana, limit)).toBe(true);
    await store().giveBackSlot(ben);
    expect(await store().takeSlot(ben, limit)).toBe(true);
    expect(await store().takeSlot(ben, limit)).toBe(false);
  });

  it("adds up an engine's spend in its window", async () => {
    const window = `test-${crypto.randomUUID()}`;
    expect(await store().usedSeconds("page", window)).toBe(0);
    await store().addSeconds("page", window, 40);
    await store().addSeconds("page", window, 5);
    expect(await store().usedSeconds("page", window)).toBe(45);
    expect(await store().usedSeconds("media", window)).toBe(0);
  });

  it("lists what is due for the sweep, oldest first", async () => {
    const m = await gathered("https://sweep1.test/", { text: null });
    await due(m.id);
    const ids = (await store().due(500)).map((t) => t.memoryId);
    expect(ids).toContain(m.id);
    const claim = (await store().claim(m.id, m.indexGeneration, 0))!.claim;
    expect((await store().due(500)).map((t) => t.memoryId)).not.toContain(m.id);
    await store().retry(claim, { delaySeconds: 3600, attempt: false });
    expect((await store().due(500)).map((t) => t.memoryId)).not.toContain(m.id);
  });
});
