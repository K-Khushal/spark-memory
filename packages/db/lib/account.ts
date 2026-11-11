import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { deletionRequested, lockOwner, ownerPrefix } from "./owner";
import {
  accountDeletion,
  aiCall,
  libraryExport,
  memory,
  session,
  user,
  verification,
  type ExportState,
} from "./schema";

/**
 * A deletion finishes only this long after it was asked for: longer than a
 * presigned upload URL lives (15 minutes, apps/server/src/files.ts) and
 * than an export build may run, so nothing signed before the request can
 * land in storage after the last pass over it.
 */
export const DELETION_GRACE_MINUTES = 20;

/** An export can be downloaded this long after it is ready, then it is removed. */
export const EXPORT_TTL_HOURS = 24;
/** A new export only this long after the last one was asked for (unless it failed). */
export const EXPORT_COOLDOWN_MINUTES = 60;
/** Longer than one build may run (a queue consumer's 15-minute wall time). */
const EXPORT_LEASE_MINUTES = 16;
const EXPORT_ATTEMPTS = 3;

/** Where an export's ZIP lives: under its owner, so deletion takes it too. */
export const exportKey = (userId: string, id: string) =>
  `${ownerPrefix(userId)}exports/${id}.zip`;

/** One signed-in device, as the owner may see it (never the token). */
export type SessionInfo = {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
};

export type LibraryExport = {
  id: string;
  state: ExportState;
  requestedAt: Date;
  readyAt: Date | null;
  bytes: number | null;
};

export type ExportRequest =
  | { started: LibraryExport; replaced?: string }
  | { refused: "busy" | "too_soon" };

const exportColumns = {
  id: libraryExport.id,
  state: libraryExport.state,
  requestedAt: libraryExport.requestedAt,
  readyAt: libraryExport.readyAt,
  bytes: libraryExport.bytes,
};

/** A ready export past its time. */
const exportExpired = sql`${libraryExport.state} = 'ready' and ${libraryExport.readyAt} < now() - make_interval(hours => ${EXPORT_TTL_HOURS})`;

/**
 * One person's account (GLOSSARY.md: their Library and how they sign in):
 * sessions, exports and deletion. Every query is scoped to `userId`.
 */
export function openAccount(db: Database, userId: string) {
  return {
    /** Signed-in devices, most recently active first. */
    sessions: (): Promise<SessionInfo[]> =>
      db
        .select({
          id: session.id,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          lastActiveAt: session.updatedAt,
        })
        .from(session)
        .where(
          and(eq(session.userId, userId), sql`${session.expiresAt} > now()`)
        )
        .orderBy(desc(session.updatedAt), desc(session.id)),

    /** Signs one device out. False when it is not one of the owner's. */
    async revokeSession(id: string): Promise<boolean> {
      const rows = await db
        .delete(session)
        .where(and(eq(session.userId, userId), eq(session.id, id)))
        .returning({ id: session.id });
      return rows.length > 0;
    },

    /** Signs every device out, this one included. */
    revokeAllSessions: async () => {
      await db.delete(session).where(eq(session.userId, userId));
    },

    /**
     * Deletion, step one: from here nobody can sign in as the owner (the
     * auth hook checks `deletionRequested`), every session ends, and no new
     * upload starts (captureImage checks under the same lock). The account
     * job does the rest with `continueDeletion`. Asking twice is harmless.
     */
    requestDeletion: () =>
      db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        await tx
          .insert(accountDeletion)
          .values({ userId })
          .onConflictDoNothing();
        await tx.delete(session).where(eq(session.userId, userId));
      }),

    /** The latest export, unless it expired. */
    async export(): Promise<LibraryExport | undefined> {
      const [row] = await db
        .select(exportColumns)
        .from(libraryExport)
        .where(
          and(eq(libraryExport.userId, userId), sql`not (${exportExpired})`)
        );
      return row;
    },

    /**
     * Starts a new export, unless one is being built or the last was asked
     * for within the cooldown (a failed one can be tried again at once).
     * `replaced` is the key of a previous ZIP for the caller to remove.
     */
    requestExport: (): Promise<ExportRequest> =>
      db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [last] = await tx
          .select({
            id: libraryExport.id,
            state: libraryExport.state,
            recent: sql<boolean>`${libraryExport.requestedAt} > now() - make_interval(mins => ${EXPORT_COOLDOWN_MINUTES})`,
          })
          .from(libraryExport)
          .where(eq(libraryExport.userId, userId));
        if (last?.state === "building") return { refused: "busy" };
        if (last?.state === "ready" && last.recent) {
          return { refused: "too_soon" };
        }
        const fresh = {
          id: crypto.randomUUID(),
          state: "building" as const,
          attempts: 0,
          leaseUntil: null,
          bytes: null,
          requestedAt: sql`now()`,
          readyAt: null,
        };
        const [started] = await tx
          .insert(libraryExport)
          .values({ userId, ...fresh })
          .onConflictDoUpdate({ target: libraryExport.userId, set: fresh })
          .returning(exportColumns);
        return {
          started: started!,
          ...(last && { replaced: exportKey(userId, last.id) }),
        };
      }),
  };
}

export type Account = ReturnType<typeof openAccount>;

/** Whether the person asked for their account to be deleted (sign-in is refused). */
export const isDeletionRequested = (db: Database, userId: string) =>
  deletionRequested(db, userId);

/** Rows of Memories deleted per statement, so no one statement runs long. */
const DELETE_BATCH = 500;

/**
 * The account job's side of the database (not scoped to one person: it
 * acts on queue messages and the hourly sweep). Every step is idempotent,
 * so a job that dies midway is simply run again.
 */
export function accountJobs(db: Database) {
  return {
    /** People whose deletion has not finished. */
    deletionsPending: async (limit = 50): Promise<string[]> =>
      (
        await db
          .select({ userId: accountDeletion.userId })
          .from(accountDeletion)
          .orderBy(accountDeletion.requestedAt)
          .limit(limit)
      ).map((r) => r.userId),

    /**
     * Deletion, step two: every object under the owner's prefix (Memory
     * files, unfinished uploads, exports), then every Memory with its
     * files, words and index rows; AI calls lose their owner but keep their
     * cost (the money was spent, and the admin totals stay true). Once the
     * grace period has passed, the pass that started after it ends with
     * the user row, which takes sessions, sign-in accounts, the export and
     * the deletion request with it. "waiting" until then: run it again.
     */
    async continueDeletion(
      userId: string,
      removeObjects: (prefix: string) => Promise<void>
    ): Promise<"done" | "waiting" | "none"> {
      const [request] = await db
        .select({
          final: sql<boolean>`${accountDeletion.requestedAt} <= now() - make_interval(mins => ${DELETION_GRACE_MINUTES})`,
          email: user.email,
        })
        .from(accountDeletion)
        .innerJoin(user, eq(user.id, accountDeletion.userId))
        .where(eq(accountDeletion.userId, userId));
      if (!request) return "none";
      await removeObjects(ownerPrefix(userId));
      for (;;) {
        const batch = db
          .select({ id: memory.id })
          .from(memory)
          .where(eq(memory.userId, userId))
          .limit(DELETE_BATCH);
        const gone = await db
          .delete(memory)
          .where(inArray(memory.id, batch))
          .returning({ id: memory.id });
        if (gone.length < DELETE_BATCH) break;
      }
      await db
        .update(aiCall)
        .set({ userId: "deleted" })
        .where(eq(aiCall.userId, userId));
      if (!request.final) return "waiting";
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        // Email codes are keyed by address, not by user (`<type>-otp-<email>`).
        const suffix = `-otp-${request.email}`;
        await tx
          .delete(verification)
          .where(
            sql`right(${verification.identifier}, ${suffix.length}) = ${suffix}`
          );
        await tx.delete(user).where(eq(user.id, userId));
      });
      return "done";
    },

    /**
     * Takes an export to build and leases it, so a duplicate message skips.
     * Undefined when it is gone, not building, leased, out of attempts, or
     * its owner is being deleted.
     */
    async claimExport(
      id: string
    ): Promise<{ userId: string; key: string } | undefined> {
      const [row] = await db
        .update(libraryExport)
        .set({
          attempts: sql`${libraryExport.attempts} + 1`,
          leaseUntil: sql`now() + make_interval(mins => ${EXPORT_LEASE_MINUTES})`,
        })
        .where(
          and(
            eq(libraryExport.id, id),
            eq(libraryExport.state, "building"),
            lt(libraryExport.attempts, EXPORT_ATTEMPTS),
            or(
              sql`${libraryExport.leaseUntil} is null`,
              sql`${libraryExport.leaseUntil} < now()`
            ),
            sql`not exists (select 1 from ${accountDeletion} d where d.user_id = ${libraryExport.userId})`
          )
        )
        .returning({ userId: libraryExport.userId });
      return row && { userId: row.userId, key: exportKey(row.userId, id) };
    },

    /** Built: ready to download. False when it was replaced meanwhile. */
    async finishExport(id: string, bytes: number): Promise<boolean> {
      const rows = await db
        .update(libraryExport)
        .set({ state: "ready", bytes, readyAt: sql`now()`, leaseUntil: null })
        .where(
          and(eq(libraryExport.id, id), eq(libraryExport.state, "building"))
        )
        .returning({ id: libraryExport.id });
      return rows.length > 0;
    },

    /**
     * A build failed: "retry" while attempts remain (the lease is released),
     * otherwise the export is Failed for good.
     */
    async failExport(id: string): Promise<"retry" | "failed"> {
      const [row] = await db
        .update(libraryExport)
        .set({
          leaseUntil: null,
          state: sql`case when ${libraryExport.attempts} >= ${EXPORT_ATTEMPTS} then 'failed' else 'building' end`,
        })
        .where(
          and(eq(libraryExport.id, id), eq(libraryExport.state, "building"))
        )
        .returning({ state: libraryExport.state });
      return row?.state === "building" ? "retry" : "failed";
    },

    /**
     * For the hourly sweep: exports out of attempts become Failed, and the
     * ids of builds whose message was lost or whose builder died, to send
     * again.
     */
    async stalledExports(): Promise<string[]> {
      const idle = sql`(${libraryExport.leaseUntil} is null and ${libraryExport.requestedAt} < now() - interval '15 minutes') or ${libraryExport.leaseUntil} < now()`;
      await db
        .update(libraryExport)
        .set({ state: "failed", leaseUntil: null })
        .where(
          and(
            eq(libraryExport.state, "building"),
            sql`${libraryExport.attempts} >= ${EXPORT_ATTEMPTS}`,
            idle
          )
        );
      const rows = await db
        .select({ id: libraryExport.id })
        .from(libraryExport)
        .where(and(eq(libraryExport.state, "building"), idle));
      return rows.map((r) => r.id);
    },

    /**
     * Removes exports past their time: the object first, then the row (a
     * failed removal leaves the row for the next sweep). Returns how many.
     */
    async removeExpiredExports(
      removeObject: (key: string) => Promise<void>
    ): Promise<number> {
      const expired = await db
        .select({ userId: libraryExport.userId, id: libraryExport.id })
        .from(libraryExport)
        .where(exportExpired)
        .limit(100);
      for (const { userId, id } of expired) {
        await removeObject(exportKey(userId, id));
        await db
          .delete(libraryExport)
          .where(and(eq(libraryExport.id, id), exportExpired));
      }
      return expired.length;
    },
  };
}

export type AccountJobs = ReturnType<typeof accountJobs>;
