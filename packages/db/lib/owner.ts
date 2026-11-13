import { eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { accountDeletion, session } from "./schema";

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

/** Seeds the per-owner Categories lock (its own lock space, two-key form). */
const CATEGORY_LOCK = 7;

/**
 * The one lock every change to a person's Categories goes through: creating,
 * renaming and deleting one, and every write that sets a Memory's Categories
 * (the categoriser, a person's edit, AI opt-out). Taken FIRST in the
 * transaction, before any Memory row is locked, and held to its end. With
 * every such path serialised here, the database trigger only has to read:
 * it takes no lock of its own, so no two of them can ever wait on each other.
 */
export const lockCategories = (tx: Pick<Database, "execute">, userId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(${CATEGORY_LOCK}::int, hashtext(${userId}))`
  );

/**
 * Takes the owner lock only when it is free. The sweep uses this so a confirm
 * or a deletion already in progress cannot hold the sweep past its budget.
 * The lock, once taken, lasts until the transaction ends.
 */
export async function tryLockOwner(
  tx: Pick<Database, "execute">,
  userId: string
): Promise<boolean> {
  const { rows } = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${userId}, ${OWNER_LOCK})) as locked`
  );
  return rows[0]?.locked === true;
}

/** Who an AI call belonged to once its owner is being deleted: the cost stays, the owner goes. */
export const ANONYMISED_USER = "deleted";

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

/**
 * Ends a just-made session if its owner is being deleted. Under the owner's
 * lock, so it orders with the deletion request: either it runs first and
 * the request's session wipe sees the session, or it runs after and sees
 * the request. Called once a session exists (the auth hook), it closes the
 * gap between checking and inserting. True when it ended the session.
 */
export const endSessionIfDeleting = (
  db: Database,
  userId: string,
  sessionId: string
): Promise<boolean> =>
  db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    if (!(await deletionRequested(tx, userId))) return false;
    await tx.delete(session).where(eq(session.id, sessionId));
    return true;
  });
