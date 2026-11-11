import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DAILY_BUDGET_KEY, INDEXING } from "@spark/core";
import {
  indexingStore,
  openAdmin,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Admin aggregates and the editable daily budget, against real Postgres.
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("admin costs, usage and the budget", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ada: string;
  let bo: string;

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ada = await newUser(db);
    bo = await newUser(db);
  });

  afterAll(async () => {
    await db
      .delete(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    await db
      .delete(schema.appSetting)
      .where(eq(schema.appSetting.key, DAILY_BUDGET_KEY));
    for (const id of [ada, bo]) {
      await db.delete(schema.aiCall).where(eq(schema.aiCall.userId, id));
      await removeUser(db, id);
    }
    await close();
  });

  const admin = () => openAdmin(db);

  async function everyone() {
    const first = await admin().users(50, 0);
    const rows = [...first.users];
    for (let offset = 50; offset < first.total; offset += 50) {
      rows.push(...(await admin().users(50, offset)).users);
    }
    return { total: first.total, rows };
  }

  it("aggregates daily spend by provider and model, and usage per person", async () => {
    const library = openLibrary(db, ada);
    const first = await library.capture({ body: "Admin usage one" });
    const second = await library.capture({ body: "Admin usage two" });
    if (!("memory" in first) || !("memory" in second)) {
      throw new Error("capture conflict");
    }
    await db.insert(schema.memoryFile).values([
      {
        memoryId: first.memory.id,
        role: "original",
        key: `users/${ada}/${first.memory.id}/original`,
        mime: "image/png",
        bytes: 2048,
        storedAt: sql`now()`,
      },
      {
        memoryId: second.memory.id,
        role: "original",
        key: `users/${ada}/${second.memory.id}/original`,
        mime: "image/png",
        bytes: 9999,
      },
    ]);
    await db.execute(
      sql`update memory_file set created_at = now() - interval '3 days'
          where r2_key = ${`users/${ada}/${second.memory.id}/original`}`
    );
    await db
      .insert(schema.aiCall)
      .values([
        call(ada, first.memory.id, "measured-a", 100, false),
        call(ada, first.memory.id, "measured-a", 250, false),
        call(ada, first.memory.id, "guessed-a", 40, true),
        call(bo, first.memory.id, "bo-cost", 50_000_000, false),
      ]);

    const spend = await admin().spend();
    expect(spend.filter((row) => row.model === "measured-a")).toEqual([
      expect.objectContaining({
        provider: "workers-ai",
        model: "measured-a",
        estimated: false,
        costMicros: 350,
        calls: 2,
      }),
    ]);
    expect(spend.filter((row) => row.model === "guessed-a")).toEqual([
      expect.objectContaining({
        estimated: true,
        costMicros: 40,
        calls: 1,
      }),
    ]);
    expect(spend[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const { total, rows } = await everyone();
    expect(total).toBeGreaterThanOrEqual(2);
    expect(rows.find((row) => row.id === ada)).toEqual({
      id: ada,
      email: `library-${ada}@example.com`,
      memories: 2,
      storageBytes: 2048,
      costMicros: 390,
    });
    const boAt = rows.findIndex((row) => row.id === bo);
    const adaAt = rows.findIndex((row) => row.id === ada);
    expect(boAt).toBeGreaterThanOrEqual(0);
    expect(adaAt).toBeGreaterThan(boAt);

    const page = await admin().users(1, 0);
    expect(page.users).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    // Other tests insert people while this runs, so the empty page is past
    // any total this database can reach, not a count taken a moment ago.
    expect((await admin().users(1, 100_000)).users).toEqual([]);
  });

  it("stores the budget the breaker reads, and logs who changed it", async () => {
    await db
      .delete(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    await db
      .delete(schema.appSetting)
      .where(eq(schema.appSetting.key, DAILY_BUDGET_KEY));
    expect((await admin().budget()).limitMicros).toBe(
      INDEXING.dailyBudgetMicros
    );
    const raised = await admin().setDailyBudget(2_500_000, ada);
    expect(raised.limitMicros).toBe(2_500_000);
    expect(await indexingStore(db).dailyBudgetMicros()).toBe(2_500_000);

    const [logged] = await db
      .select()
      .from(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    expect(logged).toMatchObject({
      previousValue: null,
      value: "2500000",
      changedBy: ada,
    });
    expect(logged?.changedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(logged)).not.toContain("@");

    await admin().setDailyBudget(2_500_000, bo);
    const still = await db
      .select()
      .from(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    expect(still).toHaveLength(1);

    await admin().setDailyBudget(3_000_000, bo);
    const changes = await db
      .select()
      .from(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    expect(changes).toHaveLength(2);
    expect(changes.find((row) => row.value === "3000000")).toMatchObject({
      previousValue: "2500000",
      changedBy: bo,
    });

    await db
      .update(schema.appSetting)
      .set({ value: "nope" })
      .where(eq(schema.appSetting.key, DAILY_BUDGET_KEY));
    expect(await indexingStore(db).dailyBudgetMicros()).toBe(
      INDEXING.dailyBudgetMicros
    );
  });

  it("keeps a single budget when two saves land together", async () => {
    await db
      .delete(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    await db
      .delete(schema.appSetting)
      .where(eq(schema.appSetting.key, DAILY_BUDGET_KEY));
    await Promise.all([
      admin().setDailyBudget(4_000_000, ada),
      admin().setDailyBudget(5_000_000, bo),
    ]);
    const state = await admin().budget();
    expect([4_000_000, 5_000_000]).toContain(state.limitMicros);
    const changes = await db
      .select()
      .from(schema.settingChange)
      .where(eq(schema.settingChange.key, DAILY_BUDGET_KEY));
    expect(changes.map((row) => row.value).sort()).toEqual([
      "4000000",
      "5000000",
    ]);
    const first = changes.find((row) => row.previousValue === null);
    const second = changes.find((row) => row.previousValue !== null);
    expect(second?.previousValue).toBe(first?.value);
    expect(state.limitMicros).toBe(Number(second?.value));
  });

  it("reports how long a Searchable Memory took, once, without its text", async () => {
    const library = openLibrary(db, ada);
    const quiet = await library.capture({
      body: "private lemon tart text",
      productAnalytics: false,
    });
    if (!("memory" in quiet)) throw new Error("capture conflict");
    await indexingStore(db).complete(
      {
        memoryId: quiet.memory.id,
        userId: ada,
        generation: quiet.memory.indexGeneration,
        run: 1,
      },
      null
    );
    expect(
      await indexingStore(db).claimFirstSearchable(quiet.memory.id)
    ).toBeUndefined();
    expect(
      await indexingStore(db).claimFirstSearchable(quiet.memory.id)
    ).toBeUndefined();

    const captured = await library.capture({
      body: "private lemon tart text",
      productAnalytics: true,
    });
    if (!("memory" in captured)) throw new Error("capture conflict");
    expect(
      await indexingStore(db).claimFirstSearchable(captured.memory.id)
    ).toBeUndefined();
    await db.execute(sql`
      update memory
      set captured_at = now() - interval '30 days'
      where id = ${captured.memory.id}
    `);
    await indexingStore(db).complete(
      {
        memoryId: captured.memory.id,
        userId: ada,
        generation: captured.memory.indexGeneration,
        run: 1,
      },
      null
    );
    const timing = await indexingStore(db).claimFirstSearchable(
      captured.memory.id
    );
    expect(timing).toMatchObject({ userId: ada, kind: "text" });
    expect(timing?.milliseconds).toBeGreaterThan(2_147_483_647);
    expect(JSON.stringify(timing)).not.toContain("lemon");
    expect(
      await indexingStore(db).claimFirstSearchable(captured.memory.id)
    ).toBeUndefined();
  });
});

function call(
  userId: string,
  memoryId: string,
  model: string,
  costMicros: number,
  estimated: boolean
) {
  return {
    userId,
    memoryId,
    day: sql`(now() at time zone 'utc')::date`,
    provider: "workers-ai" as const,
    model,
    inputTokens: 10,
    outputTokens: 5,
    costMicros,
    estimated,
  };
}
