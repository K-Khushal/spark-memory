import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { indexingStore, openDatabase, type Database } from "../index";
import { newUser } from "./users";

// The per-person AI spend cap and holds (SEC-3), against real Postgres.
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("AI spend holds", () => {
  let db: Database;
  let close: () => Promise<void>;
  const people: string[] = [];
  let recorded = 0;
  beforeAll(() => {
    ({ db, close } = openDatabase(databaseUrl!));
  });
  afterAll(async () => {
    // Today's spend is shared with every other test: put back what this one added.
    await db.execute(
      sql`update spend_day set cost_micros = greatest(0, cost_micros - ${recorded})
          where day = (now() at time zone 'utc')::date and provider = 'fake'`
    );
    for (const id of people) {
      await db.execute(sql`delete from ai_call where user_id = ${id}`);
      await db.execute(sql`delete from "user" where id = ${id}`);
    }
    await close();
  });
  // Holds count across people for a few minutes: leave none for the next test.
  afterEach(async () => {
    for (const id of people)
      await db.execute(sql`delete from ai_reservation where user_id = ${id}`);
  });
  const person = async () => {
    const id = await newUser(db);
    people.push(id);
    return id;
  };
  /** A store with a budget far above anything else spending today; 2% of $50 is $1 a person. */
  const store = (budget = 50_000_000, ownerBudgetShare = 0.02) =>
    indexingStore(db, { ownerBudgetShare, budget: async () => budget });
  const spend = (
    userId: string,
    costMicros: number,
    extra: { reservation?: string; id?: string } = {}
  ) =>
    indexingStore(db).recordCall({
      userId,
      memoryId: null,
      provider: "fake",
      model: "fake",
      usage: { inputTokens: 1, outputTokens: 0 },
      costMicros,
      ...extra,
    });
  const ok = (
    hold: Awaited<ReturnType<ReturnType<typeof store>["reserve"]>>
  ) => ("id" in hold ? hold.id : undefined);
  const settledAt = async (id: string) =>
    (
      await db.execute<{ settled: boolean }>(
        sql`select settled_at is not null as settled from ai_reservation where id = ${id}`
      )
    ).rows[0]?.settled;
  const calls = async (userId: string) =>
    (
      await db.execute<{ n: number; micros: string }>(
        sql`select count(*)::int as n, coalesce(sum(cost_micros), 0) as micros from ai_call where user_id = ${userId}`
      )
    ).rows[0]!;

  it("holds a call within the person's share, and says why not past it", async () => {
    const ana = await person();
    const ai = store();
    expect(ok(await ai.reserve({ userId: ana, micros: 600_000 }))).toBeTruthy();
    // What the hold adds counts: 600,000 held and 600,000 more is past the
    // share, but only because of the hold in flight: try again soon.
    expect(await ai.reserve({ userId: ana, micros: 600_000 })).toEqual({
      refused: "busy",
    });
    expect(ok(await ai.reserve({ userId: ana, micros: 400_000 }))).toBeTruthy();
    expect(await ai.reserve({ userId: ana, micros: 1 })).toEqual({
      refused: "busy",
    });
    // Another person has their own share.
    expect(
      ok(await ai.reserve({ userId: await person(), micros: 10 }))
    ).toBeTruthy();
  });

  it("says spent, not busy, when what was already spent leaves no room, whatever the work's priority", async () => {
    const ana = await person();
    const ai = store();
    await spend(ana, 1_000_000);
    recorded += 1_000_000;
    expect(await ai.reserve({ userId: ana, micros: 1 })).toEqual({
      refused: "spent",
    });
    // A new Capture's first run is never held by the global budget, but is held to the share.
    expect(await ai.reserve({ userId: ana, micros: 1, global: false })).toEqual(
      { refused: "spent" }
    );
    // One call bigger than the whole share can never fit.
    expect(
      await ai.reserve({ userId: await person(), micros: 1_000_001 })
    ).toEqual({ refused: "spent" });
  });

  it("lets parallel calls pass only until the share is held", async () => {
    const ana = await person();
    const ai = store();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        ai.reserve({ userId: ana, micros: 300_000 })
      )
    );
    // 300k, 600k and 900k fit in the $1 share; a fourth would hold 1.2M.
    expect(results.filter((r) => "id" in r)).toHaveLength(3);
    expect(results.filter((r) => "refused" in r)).toHaveLength(9);
  });

  it("settles exactly its own hold, whatever order calls finish in", async () => {
    const ana = await person();
    const ai = store();
    const a = ok(await ai.reserve({ userId: ana, micros: 300_000 }))!;
    const b = ok(await ai.reserve({ userId: ana, micros: 200_000 }))!;
    const c = ok(await ai.reserve({ userId: ana, micros: 100_000 }))!;
    // The last call finishes first, and cheaper than held.
    await spend(ana, 50_000, { reservation: c });
    recorded += 50_000;
    expect([
      await settledAt(a),
      await settledAt(b),
      await settledAt(c),
    ]).toEqual([false, false, true]);
    await spend(ana, 120_000, { reservation: a });
    recorded += 120_000;
    expect([
      await settledAt(a),
      await settledAt(b),
      await settledAt(c),
    ]).toEqual([true, false, true]);
    // Only b (200,000) is still held, on top of 170,000 spent: 370,000 of the
    // share; 630,000 more fits and 630,001 does not.
    expect(
      ok(await ai.reserve({ userId: ana, micros: 630_001 }))
    ).toBeUndefined();
    expect(ok(await ai.reserve({ userId: ana, micros: 630_000 }))).toBeTruthy();
  });

  it("never settles another call's hold for a call that made none", async () => {
    const ana = await person();
    const ai = store();
    const held = ok(await ai.reserve({ userId: ana, micros: 900_000 }))!;
    await spend(ana, 1_000);
    recorded += 1_000;
    expect(await settledAt(held)).toBe(false);
    // Another person's call naming this hold does not settle it either.
    await spend(await person(), 1_000, { reservation: held });
    recorded += 1_000;
    expect(await settledAt(held)).toBe(false);
  });

  it("records a settled hold's cost once, however often the same settlement is repeated", async () => {
    const ana = await person();
    const ai = store();
    const held = ok(await ai.reserve({ userId: ana, micros: 500_000 }))!;
    await spend(ana, 40_000, { reservation: held });
    await spend(ana, 40_000, { reservation: held });
    await Promise.all([
      spend(ana, 40_000, { reservation: held }),
      spend(ana, 40_000, { reservation: held }),
    ]);
    recorded += 40_000;
    expect(await calls(ana)).toEqual({ n: 1, micros: "40000" });
  });

  it("reconciles an estimate written first to the real cost by the call's id, settling the hold once", async () => {
    const ana = await person();
    const ai = store();
    const held = ok(await ai.reserve({ userId: ana, micros: 500_000 }))!;
    const id = crypto.randomUUID();
    await spend(ana, 300_000, { reservation: held, id });
    await spend(ana, 70_000, { reservation: held, id });
    await spend(ana, 70_000, { reservation: held, id });
    recorded += 70_000;
    expect(await calls(ana)).toEqual({ n: 1, micros: "70000" });
    expect(await settledAt(held)).toBe(true);
  });

  it("gives a hold back unused, safely more than once and never after settling", async () => {
    const ana = await person();
    const ai = store();
    const a = ok(await ai.reserve({ userId: ana, micros: 900_000 }))!;
    await ai.releaseHold(a);
    await ai.releaseHold(a);
    expect(await settledAt(a)).toBe(true);
    expect(await calls(ana)).toEqual({ n: 0, micros: "0" });
    expect(ok(await ai.reserve({ userId: ana, micros: 900_000 }))).toBeTruthy();
    // Settled with its cost: releasing it later does not undo anything.
    const b = ok(await ai.reserve({ userId: ana, micros: 100_000 }))!;
    await spend(ana, 5_000, { reservation: b });
    recorded += 5_000;
    await ai.releaseHold(b);
    expect(await calls(ana)).toEqual({ n: 1, micros: "5000" });
  });

  it("stops counting a hold nobody settled after a few minutes", async () => {
    const ana = await person();
    const ai = store();
    expect(ok(await ai.reserve({ userId: ana, micros: 999_990 }))).toBeTruthy();
    expect(ok(await ai.reserve({ userId: ana, micros: 10 }))).toBeTruthy();
    expect(ok(await ai.reserve({ userId: ana, micros: 10 }))).toBeUndefined();
    await db.execute(
      sql`update ai_reservation set created_at = now() - interval '7 minutes' where user_id = ${ana}`
    );
    expect(ok(await ai.reserve({ userId: ana, micros: 10 }))).toBeTruthy();
  });

  it("holds the global budget for background work across people, but not for fresh work", async () => {
    const [ana, ben, cy] = [await person(), await person(), await person()];
    const spent = await indexingStore(db).spentTodayMicros();
    // Room for 1,000,000 across everyone: 600,000 and 400,000 fit, one more does not.
    const ai = store(spent + 1_000_000, 1);
    expect(ok(await ai.reserve({ userId: ana, micros: 600_000 }))).toBeTruthy();
    expect(ok(await ai.reserve({ userId: ben, micros: 400_000 }))).toBeTruthy();
    expect(await ai.reserve({ userId: cy, micros: 1 })).toEqual({
      refused: "busy",
    });
    expect(
      ok(await ai.reserve({ userId: cy, micros: 1, global: false }))
    ).toBeTruthy();
  });

  it("never holds for a person who is gone", async () => {
    const ai = store();
    expect(
      await ai.reserve({ userId: crypto.randomUUID(), micros: 1 })
    ).toEqual({ refused: "spent" });
  });

  it("gives no share when the daily budget is $0", async () => {
    const ana = await person();
    const ai = store(0);
    expect(await ai.reserve({ userId: ana, micros: 1, global: false })).toEqual(
      { refused: "spent" }
    );
  });
});
