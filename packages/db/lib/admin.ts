import { asc, desc, eq, sql } from "drizzle-orm";
import {
  DAILY_BUDGET_KEY,
  budgetPaused,
  effectiveDailyBudgetMicros,
  type ProviderName,
} from "@spark/core";
import type { Database } from "./client";
import { UPLOAD_WINDOW_HOURS } from "./library";
import { aiCall, appSetting, spendDay, user } from "./schema";

/** How far back the admin spend table looks. */
const SPEND_DAYS = 30;
/** Per-user pages. Callers pass a limit inside this. */
export const ADMIN_USERS_LIMIT = 50;

export type DailySpend = {
  day: string;
  provider: ProviderName;
  model: string;
  estimated: boolean;
  costMicros: number;
  calls: number;
};

export type UserUsage = {
  id: string;
  email: string;
  memories: number;
  storageBytes: number;
  costMicros: number;
};

export type BudgetState = {
  limitMicros: number;
  spentMicros: number;
  paused: boolean;
};

const today = sql`(now() at time zone 'utc')::date`;

const spentToday = (db: Database) =>
  db
    .select({
      micros: sql<string>`coalesce(sum(${spendDay.costMicros}), 0)`,
    })
    .from(spendDay)
    .where(eq(spendDay.day, today));

/** The breaker's limit: the stored setting, or the config default ($1). */
export async function readDailyBudgetMicros(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, DAILY_BUDGET_KEY));
  return effectiveDailyBudgetMicros(row?.value);
}

async function budgetState(db: Database): Promise<BudgetState> {
  const [limitMicros, spent] = await Promise.all([
    readDailyBudgetMicros(db),
    spentToday(db),
  ]);
  const spentMicros = Number(spent[0]?.micros ?? 0);
  return {
    limitMicros,
    spentMicros,
    paused: budgetPaused(spentMicros, limitMicros),
  };
}

/**
 * What the admin page reads and the one setting it writes. Aggregates stay
 * in SQL. A budget change is one statement, so the logged previous value is
 * the one this write replaced, and two saves at once cannot tear the row.
 */
export function openAdmin(db: Database) {
  return {
    budget: () => budgetState(db),

    /** Daily AI spend by provider and model, newest day first. */
    async spend(): Promise<DailySpend[]> {
      const rows = await db
        .select({
          day: sql<string>`${aiCall.day}::text`,
          provider: aiCall.provider,
          model: aiCall.model,
          estimated: aiCall.estimated,
          costMicros: sql<string>`sum(${aiCall.costMicros})`,
          calls: sql<string>`count(*)`,
        })
        .from(aiCall)
        .where(
          sql`${aiCall.day} >= ((now() at time zone 'utc')::date - ${sql.raw(String(SPEND_DAYS - 1))})`
        )
        .groupBy(aiCall.day, aiCall.provider, aiCall.model, aiCall.estimated)
        .orderBy(desc(aiCall.day), desc(sql`sum(${aiCall.costMicros})`));
      return rows.map((row) => ({
        day: row.day,
        provider: row.provider,
        model: row.model,
        estimated: row.estimated,
        costMicros: Number(row.costMicros),
        calls: Number(row.calls),
      }));
    },

    /**
     * One page of people: Memories, storage (the same bytes the Free
     * allowance counts) and AI cost. Dearest first.
     */
    async users(
      limit: number,
      offset: number
    ): Promise<{ users: UserUsage[]; total: number }> {
      // Qualified: an unqualified "id" inside these subqueries binds to memory.id.
      const ownerId = sql.raw(`"user"."id"`);
      const storage = sql`(
        select coalesce(sum(f.bytes), 0) from memory_file f
        join memory m on m.id = f.memory_id
        where m.user_id = ${ownerId}
          and (f.stored_at is not null
            or f.created_at > now() - make_interval(hours => ${sql.raw(String(UPLOAD_WINDOW_HOURS))}))
      ) + (
        select coalesce(sum(octet_length(coalesce(m.body, '')) + octet_length(coalesce(m.title, ''))
          + octet_length(coalesce(m.capture_note, ''))), 0) from memory m
        where m.user_id = ${ownerId} and not m.sample
      )`;
      const cost = sql`(select coalesce(sum(cost_micros), 0) from ai_call c where c.user_id = ${ownerId})`;
      const [rows, count] = await Promise.all([
        db
          .select({
            id: user.id,
            email: user.email,
            memories: sql<string>`(select count(*) from memory m where m.user_id = ${ownerId} and not m.sample)`,
            storageBytes: sql<string>`${storage}`,
            costMicros: sql<string>`${cost}`,
          })
          .from(user)
          .orderBy(desc(cost), asc(user.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: sql<string>`count(*)` }).from(user),
      ]);
      return {
        total: Number(count[0]?.total ?? 0),
        users: rows.map((row) => ({
          id: row.id,
          email: row.email,
          memories: Number(row.memories),
          storageBytes: Number(row.storageBytes),
          costMicros: Number(row.costMicros),
        })),
      };
    },

    /**
     * Saves the daily budget and logs who changed it and when. The same
     * value again changes nothing and writes no log row. `userId` is the
     * admin's id, never their email.
     */
    async setDailyBudget(micros: number, userId: string): Promise<BudgetState> {
      const value = String(micros);
      await db.transaction(async (tx) => {
        // One saver at a time, so the log's previous value is the real one.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${DAILY_BUDGET_KEY})::bigint)`
        );
        await tx.execute(sql`
          with previous as (
            select value from app_setting where key = ${DAILY_BUDGET_KEY}
          ),
          upsert as (
            insert into app_setting (key, value, updated_by)
            values (${DAILY_BUDGET_KEY}, ${value}, ${userId})
            on conflict (key) do update set
              value = excluded.value,
              updated_by = excluded.updated_by,
              updated_at = now()
            where app_setting.value is distinct from excluded.value
          )
          insert into setting_change (key, previous_value, value, changed_by)
          select ${DAILY_BUDGET_KEY}, previous.value, ${value}, ${userId}
          from previous
          right join (select 1) as one on true
          where (select value from previous) is distinct from ${value}
        `);
      });
      return budgetState(db);
    },
  };
}

export type Admin = ReturnType<typeof openAdmin>;
