import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deepFetchStore,
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "@spark/db";
import {
  createDeepFetch,
  createDeepFetchWorker,
  fakeEngine,
  type DeepFetchRequest,
  type EngineResult,
} from "../index";

// The job against real Postgres, with the engines faked at the DeepFetch seam.
const databaseUrl = process.env.DATABASE_URL;
const ARTICLE = "Basil wants six hours of light and warm soil. ".repeat(10);
const VIDEO = "https://www.youtube.com/watch?v=";

describe.skipIf(!databaseUrl)("Deep fetch job", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ana: string;
  let ben: string;
  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ana = crypto.randomUUID();
    ben = crypto.randomUUID();
    for (const id of [ana, ben]) {
      await db
        .insert(schema.user)
        .values({ id, name: "", email: `deep-${id}@example.com` });
    }
  });
  afterAll(async () => {
    for (const id of [ana, ben]) {
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    await close();
  });

  const store = () => deepFetchStore(db);
  const row = async (id: string) =>
    (await db.select().from(schema.memory).where(eq(schema.memory.id, id)))[0]!;

  /** A Memory whose Gather came back thin, so a Deep fetch is queued. */
  async function thin(url: string, userId = ana, video = false) {
    const result = await openLibrary(db, userId).captureLink({ url });
    if (!("memory" in result)) throw new Error("conflict");
    const r = await row(result.memory.id);
    await indexingStore(db).saveGathered(
      {
        memoryId: r.id,
        userId,
        generation: r.indexGeneration,
        run: r.indexRun,
      },
      {
        text: null,
        metadata: video
          ? { video: { transcript: [], transcriptState: "unavailable" } }
          : { title: "Sign in" },
      }
    );
    // The Indexing run that gathered it has finished.
    await db
      .update(schema.memory)
      .set({ indexState: "searchable" })
      .where(eq(schema.memory.id, r.id));
    return { id: r.id, generation: r.indexGeneration, userId };
  }
  const ready = (id: string) =>
    db
      .update(schema.memory)
      .set({ deepFetchDueAt: sql`now() - interval '1 second'` })
      .where(eq(schema.memory.id, id));

  /** A worker whose engines answer from `answer`; `calls` records what they were asked. */
  function setup(
    answer: (r: DeepFetchRequest) => EngineResult,
    over: {
      page?: boolean;
      media?: boolean;
      spent?: number;
      keepScreenshot?: () => Promise<boolean>;
      now?: Date;
    } = {}
  ) {
    const calls: DeepFetchRequest[] = [];
    const engine = fakeEngine((r) => {
      calls.push(r);
      return answer(r);
    });
    const recorded: unknown[] = [];
    const indexing = indexingStore(db);
    const worker = createDeepFetchWorker({
      store: store(),
      ai: {
        spentTodayMicros: async () => over.spent ?? 0,
        dailyBudgetMicros: async () => 1_000_000,
        recordCall: async (call) => {
          recorded.push(call);
          await indexing.recordCall(call);
        },
      },
      deepFetch: createDeepFetch({
        ...(over.page !== false && { page: engine }),
        ...(over.media !== false && { media: engine }),
      }),
      ...(over.keepScreenshot && { keepScreenshot: over.keepScreenshot }),
      ...(over.now && { now: () => over.now! }),
    });
    return { run: worker.run, calls, recorded };
  }
  const job = (m: { id: string; generation: string }, run = 0) => ({
    memoryId: m.id,
    generation: m.generation,
    run,
  });
  const found: EngineResult = {
    ok: true,
    seconds: 4,
    text: ARTICLE,
    metadata: { title: "Basil", description: "Light" },
  };

  it("fetches a thin page, keeps its text as the Preserved copy and starts Indexing over", async () => {
    const m = await thin("https://page1.test/post");
    const { run, calls } = setup(() => found);
    const outcome = await run(job(m));
    expect(calls).toEqual([
      { url: "https://page1.test/post", kind: "link", maxMinutes: 60 },
    ]);
    expect(outcome).toMatchObject({
      result: "done",
      reindex: { id: m.id, indexPriority: "background" },
    });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "done",
      preservation: "preserved",
      body: ARTICLE,
      indexState: "indexing",
    });
    // Found only once: a duplicate delivery does nothing.
    expect(await run(job(m))).toEqual({ result: "skipped" });
    expect(calls).toHaveLength(1);
  });

  it("transcribes a video, records the model's cost and leaves it Reference only", async () => {
    const m = await thin(`${VIDEO}aaaaaaaaaaa`, ana, true);
    const { run, recorded } = setup(() => ({
      ok: true,
      seconds: 30,
      transcript: [{ seconds: 12, text: "Plants need sunlight." }],
      usage: [
        {
          model: "gemini-3.5-flash-lite",
          inputTokens: 100_000,
          outputTokens: 500,
        },
      ],
    }));
    expect(await run(job(m))).toMatchObject({ result: "done" });
    expect(await row(m.id)).toMatchObject({
      preservation: "reference_only",
      body: "Plants need sunlight.",
      metadata: { video: { transcriptState: "available" } },
    });
    expect(recorded).toHaveLength(1);
    const [spend] = await db
      .select()
      .from(schema.aiCall)
      .where(eq(schema.aiCall.memoryId, m.id));
    expect(spend).toMatchObject({ provider: "gemini", inputTokens: 100_000 });
    expect(spend!.costMicros).toBeGreaterThan(0);
  });

  it("records the cost of a model call a failed job still made, at the audio price", async () => {
    const m = await thin(`${VIDEO}hhhhhhhhhhh`, ana, true);
    const { run, recorded } = setup(() => ({
      ok: false,
      reason: "error",
      seconds: 20,
      usage: [
        {
          model: "gemini-3.5-flash-lite",
          inputTokens: 1_000_000,
          outputTokens: 0,
          audio: true,
        },
      ],
    }));
    expect(await run(job(m))).toEqual({ result: "later", delaySeconds: 3600 });
    expect(recorded).toHaveLength(1);
    const [spend] = await db
      .select()
      .from(schema.aiCall)
      .where(eq(schema.aiCall.memoryId, m.id));
    // $0.30 a million audio tokens, in micro-dollars.
    expect(spend).toMatchObject({ provider: "gemini", costMicros: 300_000 });
  });

  it("retries after one hour, then 24 hours, then fails for good", async () => {
    const m = await thin("https://nothing1.test/");
    const { run, calls } = setup(() => ({
      ok: false,
      reason: "nothing",
      seconds: 2,
    }));
    expect(await run(job(m))).toEqual({ result: "later", delaySeconds: 3600 });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 1,
    });
    // Not due yet: the message is not an attempt.
    expect(await run(job(m))).toEqual({ result: "skipped" });
    await ready(m.id);
    expect(await run(job(m))).toEqual({ result: "later", delaySeconds: 86400 });
    await ready(m.id);
    expect(await run(job(m))).toEqual({ result: "failed" });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "failed",
      deepFetchError: "nothing",
      deepFetchAttempts: 3,
    });
    expect(calls).toHaveLength(3);
    // Try Again is a new run with all its attempts.
    await openLibrary(db, ana).retryDeepFetch(m.id);
    expect(await run(job(m, 1))).toEqual({
      result: "later",
      delaySeconds: 3600,
    });
  });

  it("fails at once for a page that is not public, and never retries it", async () => {
    const m = await thin("https://private1.test/");
    const { run } = setup(() => ({
      ok: false,
      reason: "not_public",
      seconds: 0,
    }));
    expect(await run(job(m))).toEqual({ result: "failed" });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "failed",
      deepFetchError: "not_public",
    });
  });

  it("is Unavailable, without trying, when the kind's engine is not configured", async () => {
    const page = await thin("https://noengine1.test/");
    const video = await thin(`${VIDEO}bbbbbbbbbbb`, ana, true);
    const { run, calls } = setup(() => found, { page: false, media: false });
    expect(await run(job(page))).toEqual({ result: "unavailable" });
    expect(await run(job(video))).toEqual({ result: "unavailable" });
    expect(await row(page.id)).toMatchObject({
      deepFetchState: "unavailable",
      deepFetchAttempts: 0,
    });
    expect(calls).toEqual([]);
    // An operator state: nothing shows and Try Again cannot start it again.
    expect((await openLibrary(db, ana).get(page.id))!.deepFetch).toBeNull();
    expect(
      (await openLibrary(db, ana).retryDeepFetch(page.id))!.deepFetchRun
    ).toBe(0);
  });

  it("is Unavailable, giving the slot back, when the container is not set up to transcribe", async () => {
    const m = await thin(`${VIDEO}ggggggggggg`, ana, true);
    const day = new Date().toISOString().slice(0, 10);
    const used = async () =>
      (
        await db
          .select()
          .from(schema.usageDay)
          .where(eq(schema.usageDay.userId, ana))
      ).find((r) => r.day === day)?.deepFetches ?? 0;
    const before = await used();
    const { run } = setup(() => ({
      ok: false,
      reason: "unavailable",
      seconds: 1,
    }));
    expect(await run(job(m))).toEqual({ result: "unavailable" });
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "unavailable",
      deepFetchAttempts: 0,
    });
    expect(await used()).toBe(before);
  });

  it("stops for a video whose AI opt-out was switched on while it waited", async () => {
    const m = await thin(`${VIDEO}ccccccccccc`, ana, true);
    await db
      .update(schema.memory)
      .set({ aiOptOut: true })
      .where(eq(schema.memory.id, m.id));
    const { run, calls } = setup(() => found);
    expect(await run(job(m))).toEqual({ result: "stopped" });
    expect(calls).toEqual([]);
    expect((await row(m.id)).deepFetchState).toBeNull();
  });

  it("fetches a page for a Memory with AI opt-out: no AI reads it", async () => {
    const m = await thin("https://optout1.test/");
    await db
      .update(schema.memory)
      .set({ aiOptOut: true })
      .where(eq(schema.memory.id, m.id));
    const { run, calls } = setup(() => found);
    expect(await run(job(m))).toMatchObject({ result: "done" });
    expect(calls).toHaveLength(1);
  });

  it("holds a video while the daily AI budget is spent, without using an attempt", async () => {
    const m = await thin(`${VIDEO}ddddddddddd`, ana, true);
    const { run, calls } = setup(() => found, { spent: 1_000_000 });
    const outcome = await run(job(m));
    expect(outcome).toMatchObject({ result: "later" });
    expect(calls).toEqual([]);
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 0,
    });
  });

  it("allows 20 a person a day: the next waits for tomorrow, and another person is not held", async () => {
    const limit = 20;
    const day = (
      await db.execute<{ d: string }>(
        sql`select (now() at time zone 'utc')::date::text as d`
      )
    ).rows[0]!.d;
    await db
      .insert(schema.usageDay)
      .values({ userId: ben, day, deepFetches: limit })
      .onConflictDoUpdate({
        target: [schema.usageDay.userId, schema.usageDay.day],
        set: { deepFetches: limit },
      });
    const held = await thin("https://limit1.test/", ben);
    const free = await thin("https://limit2.test/", ana);
    const { run, calls } = setup(() => found);
    const outcome = await run(job(held));
    expect(outcome).toMatchObject({ result: "later" });
    expect(outcome.result === "later" && outcome.delaySeconds).toBeGreaterThan(
      0
    );
    expect(
      outcome.result === "later" && outcome.delaySeconds
    ).toBeLessThanOrEqual(86400);
    expect(await row(held.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 0,
    });
    expect(calls).toEqual([]);
    expect(await run(job(free))).toMatchObject({ result: "done" });
  });

  it("queues for the next month once an engine's free tier is spent, then runs", async () => {
    const m = await thin(`${VIDEO}eeeeeeeeeee`, ana, true);
    const now = new Date("2031-03-15T10:00:00Z");
    await store().addSeconds("media", "2031-03", 150_000);
    const { run, calls } = setup(() => found, { now });
    const outcome = await run(job(m));
    expect(outcome).toMatchObject({ result: "later" });
    // 16.5 days to April: far more than a queue may delay a message.
    expect(outcome.result === "later" && outcome.delaySeconds).toBe(
      Math.ceil((Date.UTC(2031, 3, 1) - now.getTime()) / 1000)
    );
    expect(calls).toEqual([]);
    const { days } = (
      await db.execute<{ days: number }>(
        sql`select extract(epoch from (deep_fetch_due_at - now())) / 86400 as days from memory where id = ${m.id}`
      )
    ).rows[0]!;
    expect(Number(days)).toBeGreaterThan(14);
    // The same Memory, next month's window: it runs.
    await ready(m.id);
    const april = setup(
      () => ({
        ok: true,
        seconds: 1,
        transcript: [{ seconds: 1, text: "Hi there friend." }],
      }),
      {
        now: new Date("2031-04-01T00:00:01Z"),
      }
    );
    expect(await april.run(job(m))).toMatchObject({ result: "done" });
  });

  it("counts what the engine used against its free tier, failed or not", async () => {
    const m = await thin("https://spend1.test/");
    const window = new Date().toISOString().slice(0, 10);
    const before = await store().usedSeconds("page", window);
    const { run } = setup(() => ({ ok: false, reason: "error", seconds: 7 }));
    await run(job(m));
    expect(await store().usedSeconds("page", window)).toBe(before + 7);
  });

  it("gives the slot back and waits when the engine is out of free tier itself", async () => {
    const m = await thin("https://limit3.test/");
    const day = new Date().toISOString().slice(0, 10);
    const used = async () =>
      (
        await db
          .select()
          .from(schema.usageDay)
          .where(eq(schema.usageDay.userId, ana))
      ).find((r) => r.day === day)?.deepFetches ?? 0;
    const before = await used();
    const { run } = setup(() => ({ ok: false, reason: "limit", seconds: 0 }));
    expect(await run(job(m))).toMatchObject({ result: "later" });
    expect(await used()).toBe(before);
    expect(await row(m.id)).toMatchObject({
      deepFetchState: "queued",
      deepFetchAttempts: 0,
    });
  });

  it("keeps a screenshot alone as success, and a failing screenshot never fails the job", async () => {
    const shot = { bytes: new Uint8Array([1]), width: 1280, height: 800 };
    const onlyShot = await thin("https://shot1.test/");
    let kept = 0;
    const a = setup(() => ({ ok: true, seconds: 3, screenshot: shot }), {
      keepScreenshot: async () => {
        kept++;
        return true;
      },
    });
    expect(await a.run(job(onlyShot))).toEqual({ result: "done" });
    expect(kept).toBe(1);
    expect((await row(onlyShot.id)).indexRun).toBe(1);

    const broken = await thin("https://shot2.test/");
    const b = setup(() => ({ ...found, screenshot: shot }), {
      keepScreenshot: async () => {
        throw new Error("storage down");
      },
    });
    expect(await b.run(job(broken))).toMatchObject({ result: "done" });
    expect(await row(broken.id)).toMatchObject({ body: ARTICLE });
  });

  it("ignores a message for another run, another Memory with the id, or a deleted Memory", async () => {
    const m = await thin("https://fence1.test/");
    const { run, calls } = setup(() => found);
    expect(await run(job(m, 5))).toEqual({ result: "skipped" });
    expect(await run({ ...job(m), generation: crypto.randomUUID() })).toEqual({
      result: "skipped",
    });
    await db.delete(schema.memory).where(eq(schema.memory.id, m.id));
    expect(await run(job(m))).toEqual({ result: "skipped" });
    expect(calls).toEqual([]);
  });
});
