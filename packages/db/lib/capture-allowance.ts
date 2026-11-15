import { sql, type SQL } from "drizzle-orm";
import { FREE_ALLOWANCE } from "@spark/core";
import type { Database } from "./client";
import { usageDay } from "./schema";

/** Atomically pays for a new Capture, in the transaction that creates it. */
export async function takeDailyCapture(
  tx: Pick<Database, "insert">,
  userId: string,
  day: string | SQL,
  limit: number = FREE_ALLOWANCE.capturesPerDay
): Promise<boolean> {
  const rows = await tx
    .insert(usageDay)
    .values({ userId, day, captures: 1 })
    .onConflictDoUpdate({
      target: [usageDay.userId, usageDay.day],
      set: { captures: sql`${usageDay.captures} + 1` },
      setWhere: sql`${usageDay.captures} < ${limit}`,
    })
    .returning({ n: usageDay.captures });
  return rows.length > 0;
}

/**
 * Atomically takes one of today's keeps: a save past the daily Captures that
 * is still stored (partly Indexed). False once `keptPerDay` are used.
 */
export async function takeDailyKeep(
  tx: Pick<Database, "insert">,
  userId: string,
  day: string | SQL,
  limit: number = FREE_ALLOWANCE.keptPerDay
): Promise<boolean> {
  const rows = await tx
    .insert(usageDay)
    .values({ userId, day, kept: 1 })
    .onConflictDoUpdate({
      target: [usageDay.userId, usageDay.day],
      set: { kept: sql`${usageDay.kept} + 1` },
      setWhere: sql`${usageDay.kept} < ${limit}`,
    })
    .returning({ n: usageDay.kept });
  return rows.length > 0;
}
