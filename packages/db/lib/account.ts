import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "./client";
import { SWEEP_CURSOR_KEY } from "./library";
import { ANONYMISED_USER, lockOwner, ownerPrefix } from "./owner";
import {
  accountDeletion,
  aiCall,
  appSetting,
  libraryExport,
  memory,
  objectRemoval,
  session,
  settingChange,
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
/** Every kind of email code Better Auth's email OTP plugin keys by address. */
const OTP_TYPES = [
  "sign-in",
  "email-verification",
  "forget-password",
  "change-email",
] as const;

/** Where an export's ZIP lives: under its owner, so deletion takes it too. */
export const exportKey = (userId: string, id: string, attempt: number) =>
  `${ownerPrefix(userId)}exports/${id}/${attempt}.zip`;

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
  /** The finished ZIP's storage key (server only). */
  key: string | null;
};

export type ExportRequest =
  { started: LibraryExport } | { refused: "busy" | "too_soon" };

const exportColumns = {
  id: libraryExport.id,
  state: libraryExport.state,
  requestedAt: libraryExport.requestedAt,
  readyAt: libraryExport.readyAt,
  bytes: libraryExport.bytes,
  key: libraryExport.key,
};

/** A ready export past its time. */
const exportExpired = sql`${libraryExport.state} = 'ready' and ${libraryExport.readyAt} < now() - make_interval(hours => ${EXPORT_TTL_HOURS})`;

/**
 * One person's sign-in and the things around their Library:
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
     * The previous ZIP is recorded for removal in the same transaction, due
     * once a builder still writing it must have stopped (sweepExports).
     */
    requestExport: (): Promise<ExportRequest> =>
      db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [last] = await tx
          .select({
            key: libraryExport.key,
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
          key: null,
          requestedAt: sql`now()`,
          readyAt: null,
        };
        const [started] = await tx
          .insert(libraryExport)
          .values({ userId, ...fresh })
          .onConflictDoUpdate({ target: libraryExport.userId, set: fresh })
          .returning(exportColumns);
        // The finished ZIP goes; abandoned attempts were recorded when claimed.
        if (last?.key) {
          await tx
            .insert(objectRemoval)
            .values({ key: last.key })
            .onConflictDoNothing();
        }
        return { started: started! };
      }),
  };
}

export type Account = ReturnType<typeof openAccount>;

/** Rows of Memories deleted per statement, so no one statement runs long. */
const DELETE_BATCH = 500;

/** Where the deletion sweep stopped, so the next hour continues with the next person. */
const DELETION_CURSOR_KEY = "sweep_deletion_cursor";

/**
 * The account job's side of the database (not scoped to one person: it
 * acts on queue messages and the hourly sweep). Every step is idempotent,
 * so a job that dies midway is simply run again.
 */
export function accountJobs(db: Database) {
  return {
    /**
     * People whose deletion has not finished, oldest first. Continues after
     * the last batch this sweep handed out, and skips ids already attempted
     * in this run, so a stuck one cannot take every place. Wraps once the
     * rest of the queue is empty.
     */
    deletionsPending: async (
      limit = 50,
      skip: readonly string[] = []
    ): Promise<string[]> =>
      db.transaction(async (tx) => {
        const [cursor] = await tx
          .select({ value: appSetting.value })
          .from(appSetting)
          .where(eq(appSetting.key, DELETION_CURSOR_KEY));
        const page = (after: string | undefined, exclude: readonly string[]) =>
          tx
            .select({ userId: accountDeletion.userId })
            .from(accountDeletion)
            .where(
              and(
                exclude.length
                  ? notInArray(accountDeletion.userId, [...exclude])
                  : undefined,
                after
                  ? sql`(${accountDeletion.requestedAt}, ${accountDeletion.userId}) > (
                      select requested_at, user_id from account_deletion
                      where user_id = ${after}
                    )`
                  : undefined
              )
            )
            .orderBy(
              asc(accountDeletion.requestedAt),
              asc(accountDeletion.userId)
            )
            .limit(limit);
        let rows = await page(cursor?.value, skip);
        if (rows.length < limit) {
          const rest = await page(undefined, [
            ...skip,
            ...rows.map((row) => row.userId),
          ]);
          rows = [...rows, ...rest].slice(0, limit);
        }
        const last = rows.at(-1)?.userId;
        if (last) {
          await tx
            .insert(appSetting)
            .values({
              key: DELETION_CURSOR_KEY,
              value: last,
              updatedBy: "sweep",
            })
            .onConflictDoUpdate({
              target: appSetting.key,
              set: { value: last, updatedAt: sql`now()` },
            });
        }
        return rows.map((row) => row.userId);
      }),

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
      const anonymise = (tx: Pick<Database, "update">) =>
        tx
          .update(aiCall)
          .set({ userId: ANONYMISED_USER })
          .where(eq(aiCall.userId, userId));
      await anonymise(db);
      // A sign-in that passed the hook just before the request committed
      // may have made a session after it: every pass ends them again.
      await db.delete(session).where(eq(session.userId, userId));
      if (!request.final) return "waiting";
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        // Email codes are keyed by address, not by user: exactly these.
        await tx.delete(verification).where(
          inArray(
            verification.identifier,
            OTP_TYPES.map((type) => `${type}-otp-${request.email}`)
          )
        );
        // Its objects went with the prefix: nothing left to remove.
        await tx
          .delete(objectRemoval)
          .where(
            sql`starts_with(${objectRemoval.key}, ${ownerPrefix(userId)})`
          );
        await tx.delete(user).where(eq(user.id, userId));
        await tx
          .delete(appSetting)
          .where(
            and(
              eq(appSetting.key, SWEEP_CURSOR_KEY),
              eq(appSetting.value, userId)
            )
          );
        await anonymise(tx);
        // An admin's setting changes stay (values and history), not their id.
        await tx
          .update(appSetting)
          .set({ updatedBy: ANONYMISED_USER })
          .where(eq(appSetting.updatedBy, userId));
        await tx
          .update(settingChange)
          .set({ changedBy: ANONYMISED_USER })
          .where(eq(settingChange.changedBy, userId));
      });
      return "done";
    },

    /**
     * Takes an export to build and leases it, so a duplicate message skips.
     * In the same transaction its ZIP is recorded for removal once the lease
     * is over; only `finishExport` clears that record, so a ZIP whose build
     * failed, or whose builder died after completing the upload, is always
     * removed by the sweep. Undefined when it is gone, not building, leased,
     * out of attempts, or its owner is being deleted.
     */
    claimExport: (
      id: string
    ): Promise<{ userId: string; attempt: number; key: string } | undefined> =>
      db.transaction(async (tx) => {
        const [row] = await tx
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
          .returning({
            userId: libraryExport.userId,
            attempt: libraryExport.attempts,
          });
        if (!row) return undefined;
        // This attempt's own object: no other attempt ever writes it.
        const key = exportKey(row.userId, id, row.attempt);
        await tx
          .insert(objectRemoval)
          .values({
            key,
            dueAt: sql`now() + make_interval(mins => ${EXPORT_LEASE_MINUTES})`,
          })
          .onConflictDoNothing();
        return { userId: row.userId, attempt: row.attempt, key };
      }),

    /**
     * Built: ready to download from this attempt's ZIP, which is no longer
     * up for removal (one transaction). False when the export was replaced
     * or a newer attempt took it over: this attempt's ZIP stays up for
     * removal.
     */
    finishExport: (
      id: string,
      attempt: number,
      bytes: number
    ): Promise<boolean> =>
      db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ userId: libraryExport.userId })
          .from(libraryExport)
          .where(eq(libraryExport.id, id));
        if (!owner) return false;
        const key = exportKey(owner.userId, id, attempt);
        const [row] = await tx
          .update(libraryExport)
          .set({
            state: "ready",
            bytes,
            readyAt: sql`now()`,
            leaseUntil: null,
            key,
          })
          .where(
            and(
              eq(libraryExport.id, id),
              eq(libraryExport.state, "building"),
              eq(libraryExport.attempts, attempt)
            )
          )
          .returning({ id: libraryExport.id });
        if (!row) return false;
        await tx.delete(objectRemoval).where(eq(objectRemoval.key, key));
        return true;
      }),

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
    async stalledExports(limit?: number): Promise<string[]> {
      // Never claimed for a while, or its lease ran out (one condition).
      const idle = or(
        and(
          sql`${libraryExport.leaseUntil} is null`,
          sql`${libraryExport.requestedAt} < now() - make_interval(mins => ${EXPORT_LEASE_MINUTES})`
        ),
        sql`${libraryExport.leaseUntil} < now()`
      );
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
      const query = db
        .select({ id: libraryExport.id })
        .from(libraryExport)
        .where(and(eq(libraryExport.state, "building"), idle))
        .orderBy(libraryExport.id);
      const rows = limit === undefined ? await query : await query.limit(limit);
      return rows.map((r) => r.id);
    },

    /**
     * Exports past their time let go of their ZIP (row deleted, removal
     * recorded, in one statement); then due removals are drained a batch at
     * a time: storage first, then the records, so a failure keeps them for
     * the next sweep. Stops after the batch that passes `deadline` (epoch
     * ms) and goes on next time. Returns how many objects went.
     */
    async sweepExports(
      removeObjects: (keys: string[]) => Promise<void>,
      {
        batch = 100,
        deadline = Date.now() + 20_000,
        allowCall,
      }: {
        batch?: number;
        deadline?: number;
        /** False once this invocation has spent its storage calls. */
        allowCall?: () => boolean;
      } = {}
    ): Promise<number> {
      await db.execute(sql`
        with expired as (
          delete from ${libraryExport} where ${exportExpired}
          returning ${libraryExport.key} as key)
        insert into ${objectRemoval} (key)
        select key from expired where key is not null
        on conflict do nothing`);
      let removed = 0;
      for (;;) {
        const due = await db
          .select({ key: objectRemoval.key })
          .from(objectRemoval)
          .where(sql`${objectRemoval.dueAt} <= now()`)
          .orderBy(objectRemoval.dueAt)
          .limit(batch);
        if (!due.length) return removed;
        if (allowCall && !allowCall()) return removed;
        const keys = due.map((d) => d.key);
        await removeObjects(keys);
        // Only records still due go (keys are never reused by a later
        // attempt, so what was selected is an abandoned object).
        await db
          .delete(objectRemoval)
          .where(
            and(
              inArray(objectRemoval.key, keys),
              sql`${objectRemoval.dueAt} <= now()`
            )
          );
        removed += keys.length;
        if (due.length < batch || Date.now() >= deadline) return removed;
      }
    },
  };
}

export type AccountJobs = ReturnType<typeof accountJobs>;
