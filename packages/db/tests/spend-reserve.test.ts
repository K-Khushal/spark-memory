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
  beforeAll(() => {
    ({ db, close } = openDatabase(databaseUrl!));
  });
  let recorded = 0;
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
  const store = async (budget = 50_000_000, ownerBudgetShare = 0.02) =>
    indexingStore(db, { ownerBudgetShare, budget: async () => budget });
  const spend = (userId: string, costMicros: number) => {
    recorded += costMicros;
    return indexingStore(db).recordCall({
      userId,
      memoryId: null,
      provider: "fake",
      model: "fake",
      usage: { inputTokens: 1, outputTokens: 0 },
      costMicros,
    });
  };

  it("holds a call within the person's share, and says no past it", async () => {
    const ana = await person();
    const ai = await store();
    expect(await ai.reserve({ userId: ana, micros: 600_000 })).toBe(true);
    // What the hold adds counts: 600,000 held and 600,000 more is past the share.
    expect(await ai.reserve({ userId: ana, micros: 600_000 })).toBe(false);
    expect(await ai.reserve({ userId: ana, micros: 400_000 })).toBe(true);
    expect(await ai.reserve({ userId: ana, micros: 1 })).toBe(false);
    // Another person has their own share.
    expect(await ai.reserve({ userId: await person(), micros: 10 })).toBe(true);
  });

  it("counts what the person already spent today, whatever the work's priority", async () => {
    const ana = await person();
    const ai = await store();
    await spend(ana, 1_000_000);
    expect(await ai.reserve({ userId: ana, micros: 1 })).toBe(false);
    // A new Capture's first run is never held by the global budget, but is held to the share.
    expect(await ai.reserve({ userId: ana, micros: 1, global: false })).toBe(
      false
    );
  });

  it("lets parallel calls pass only until the share is held", async () => {
    const ana = await person();
    const ai = await store(); // $1
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        ai.reserve({ userId: ana, micros: 300_000 })
      )
    );
    // 300k, 600k and 900k fit in the $1 share; a fourth would hold 1.2M.
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("replaces a hold with the real cost when the call is recorded, so the estimate is not counted twice", async () => {
    const ana = await person();
    const ai = await store();
    expect(await ai.reserve({ userId: ana, micros: 900_000 })).toBe(true);
    expect(await ai.reserve({ userId: ana, micros: 100_000 })).toBe(true);
    expect(await ai.reserve({ userId: ana, micros: 1 })).toBe(false);
    await spend(ana, 100_000);
    // The 900,000 hold became 100,000 spent: 200,000 in all, so there is room again.
    expect(await ai.reserve({ userId: ana, micros: 800_000 })).toBe(true);
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ai_reservation where user_id = ${ana}`
    );
    // The oldest hold went when the call was recorded.
    expect(rows[0]!.n).toBe(2);
  });

  it("stops counting a hold nobody used after a few minutes", async () => {
    const ana = await person();
    const ai = await store();
    expect(await ai.reserve({ userId: ana, micros: 999_990 })).toBe(true);
    expect(await ai.reserve({ userId: ana, micros: 10 })).toBe(true);
    expect(await ai.reserve({ userId: ana, micros: 10 })).toBe(false);
    await db.execute(
      sql`update ai_reservation set created_at = now() - interval '7 minutes' where user_id = ${ana}`
    );
    expect(await ai.reserve({ userId: ana, micros: 10 })).toBe(true);
  });

  it("holds the global budget for background work across people, but not for fresh work", async () => {
    const [ana, ben, cy] = [await person(), await person(), await person()];
    const spent = await indexingStore(db).spentTodayMicros();
    // Room for 1,000,000 across everyone: 600,000 and 400,000 fit, one more does not.
    const ai = await store(spent + 1_000_000, 1);
    expect(await ai.reserve({ userId: ana, micros: 600_000 })).toBe(true);
    expect(await ai.reserve({ userId: ben, micros: 400_000 })).toBe(true);
    expect(await ai.reserve({ userId: cy, micros: 1 })).toBe(false);
    expect(await ai.reserve({ userId: cy, micros: 1, global: false })).toBe(
      true
    );
  });

  it("never holds for a person who is gone", async () => {
    const ai = await store();
    expect(await ai.reserve({ userId: crypto.randomUUID(), micros: 1 })).toBe(
      false
    );
  });

  it("gives no share when the daily budget is $0", async () => {
    const ana = await person();
    const ai = await store(0);
    expect(await ai.reserve({ userId: ana, micros: 1, global: false })).toBe(
      false
    );
  });
});
