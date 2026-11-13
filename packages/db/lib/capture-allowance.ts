import { sql, type SQL } from "drizzle-orm";
import { FREE_ALLOWANCE } from "@spark/core";
import type { Database } from "./client";
import { usageDay } from "./schema";

/** Atomically pays for a new Capture, in the transaction that creates it. */
export async function takeDailyCapture(
  tx: Pick<Database, "insert">,
  userId: string,
  day: string | SQL
): Promise<boolean> {
  const rows = await tx
    .insert(usageDay)
    .values({ userId, day, captures: 1 })
    .onConflictDoUpdate({
      target: [usageDay.userId, usageDay.day],
      set: { captures: sql`${usageDay.captures} + 1` },
      setWhere: sql`${usageDay.captures} < ${FREE_ALLOWANCE.capturesPerDay}`,
    })
    .returning({ n: usageDay.captures });
  return rows.length > 0;
}
