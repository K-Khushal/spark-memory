import { eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { accountDeletion } from "./schema";

/** Seeds the per-owner advisory lock (its own lock space). */
const OWNER_LOCK = 6;

/**
 * One owner's uploads change one at a time: storage checks, retries,
 * confirmations, the sweep and account deletion all take this lock, until
 * the transaction ends.
 */
export const lockOwner = (tx: Pick<Database, "execute">, userId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${OWNER_LOCK}))`
  );

/** Every object of one owner starts with this (keys are the server's). */
export const ownerPrefix = (userId: string) => `users/${userId}/`;

/** Whether the owner asked for their account to be deleted (account.ts); sign-in is refused meanwhile. */
export async function deletionRequested(
  tx: Pick<Database, "select">,
  userId: string
): Promise<boolean> {
  const rows = await tx
    .select({ userId: accountDeletion.userId })
    .from(accountDeletion)
    .where(eq(accountDeletion.userId, userId));
  return rows.length > 0;
}
