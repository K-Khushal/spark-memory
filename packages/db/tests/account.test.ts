import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { ImageCapture } from "@spark/core";
import {
  accountJobs,
  ANONYMISED_USER,
  endSessionIfDeleting,
  exportKey,
  indexingStore,
  isDeletionRequested,
  openAccount,
  openDatabase,
  openLibrary,
  SWEEP_CURSOR_KEY,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Sessions, exports and deletion against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

const image = (): ImageCapture => ({
  id: crypto.randomUUID(),
  mime: "image/png",
  bytes: 2048,
  width: 800,
  height: 600,
  contentHash: "ab".repeat(32),
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: 300 },
});

describe.skipIf(!databaseUrl)("an account", () => {
  let db: Database;
  let close: () => Promise<void>;
  const people: string[] = [];

  beforeAll(() => {
    ({ db, close } = openDatabase(databaseUrl!));
  });
  afterAll(async () => {
    for (const id of people) await removeUser(db, id);
    await close();
  });

  const person = async () => {
    const id = await newUser(db);
    people.push(id);
    return id;
  };

  const signIn = async (userId: string, at = "now()") => {
    const id = crypto.randomUUID();
    await db.insert(schema.session).values({
      id,
      userId,
      token: crypto.randomUUID(),
      userAgent: "Mozilla/5.0",
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: sql.raw(at) as unknown as Date,
    });
    return id;
  };

  const sessionsOf = async (userId: string) =>
    (await openAccount(db, userId).sessions()).map((s) => s.id);

  /** Fills a Library with what a deletion must take: text, an image, an index, an AI call. */
  async function fill(userId: string) {
    const library = openLibrary(db, userId);
    const text = await library.capture({ body: "Lemon tart" });
    if (!("memory" in text)) throw new Error("conflict");
    await db.insert(schema.memoryIndex).values({
      memoryId: text.memory.id,
      title: "Tart",
      description: "A lemon tart",
      ocrText: "",
      entities: [],
      tags: ["baking"],
      model: "fake",
    });
    const img = await library.captureImage(image());
    if (!("memory" in img)) throw new Error("not created");
    await library.markStored(img.memory.id);
    await db.insert(schema.aiCall).values({
      userId,
      memoryId: text.memory.id,
      day: "2026-11-11",
      provider: "gemini",
      model: "fake",
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 7,
    });
    await signIn(userId);
    return { text: text.memory.id, image: img.memory.id };
  }

  /** Holds `userId`'s owner lock in its own connection until `release` runs, as a deletion's transaction does. */
  async function holdOwnerLock(
    userId: string,
    work: (tx: Database) => Promise<void>
  ) {
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    let locked!: () => void;
    const isLocked = new Promise<void>((done) => (locked = done));
    const finished = db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 6))`
      );
      await work(tx as unknown as Database);
      locked();
      await released;
    });
    await isLocked;
    return { release, finished };
  }

  /** Whether `promise` is still waiting after a moment (blocked on a lock). */
  const stillWaiting = async (promise: Promise<unknown>) =>
    (await Promise.race([
      promise.then(() => "done"),
      new Promise((done) => setTimeout(() => done("waiting"), 300)),
    ])) === "waiting";

  const aiCallOwners = async (memoryId: string) =>
    (
      await db
        .select({ userId: schema.aiCall.userId })
        .from(schema.aiCall)
        .where(eq(schema.aiCall.memoryId, memoryId))
    ).map((r) => r.userId);

  const recordCall = (userId: string, memoryId: string) =>
    indexingStore(db).recordCall({
      userId,
      memoryId,
      provider: "gemini",
      model: "fake",
      usage: { inputTokens: 1, outputTokens: 1 },
      costMicros: 3,
    });

  const count = async (table: string, column: string, value: string) => {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${value}`
    );
    return rows[0]!.n;
  };

  describe("sessions", () => {
    it("lists only the owner's devices, most recently active first", async () => {
      const ana = await person();
      const ben = await person();
      const older = await signIn(ana, "now() - interval '3 days'");
      const newer = await signIn(ana);
      await signIn(ben);
      expect(await sessionsOf(ana)).toEqual([newer, older]);
    });

    it("signs out one device, never another person's, or every device", async () => {
      const ana = await person();
      const ben = await person();
      const phone = await signIn(ana);
      const laptop = await signIn(ana);
      const bens = await signIn(ben);
      expect(await openAccount(db, ana).revokeSession(bens)).toBe(false);
      expect(await openAccount(db, ana).revokeSession(phone)).toBe(true);
      expect(await sessionsOf(ana)).toEqual([laptop]);
      await openAccount(db, ana).revokeAllSessions();
      expect(await sessionsOf(ana)).toEqual([]);
      expect(await sessionsOf(ben)).toEqual([bens]);
    });
  });

  describe("deletion", () => {
    const age = (userId: string) =>
      db
        .update(schema.accountDeletion)
        .set({ requestedAt: sql`now() - interval '21 minutes'` })
        .where(eq(schema.accountDeletion.userId, userId));

    it("signs every device out at once and takes no new uploads", async () => {
      const ana = await person();
      await signIn(ana);
      await openAccount(db, ana).requestDeletion();
      expect(await isDeletionRequested(db, ana)).toBe(true);
      expect(await sessionsOf(ana)).toEqual([]);
      expect(await openLibrary(db, ana).captureImage(image())).toEqual({
        conflict: true,
      });
      // A sign-in that slipped past the check just before the request: the
      // next pass ends it too.
      await signIn(ana);
      await accountJobs(db).continueDeletion(ana, async () => {});
      expect(await sessionsOf(ana)).toEqual([]);
    });

    it("removes everything of the person and nothing of anyone else", async () => {
      const ana = await person();
      const ben = await person();
      await fill(ana);
      const bens = await fill(ben);
      await db.insert(schema.verification).values({
        id: crypto.randomUUID(),
        identifier: `sign-in-otp-library-${ana}@example.com`,
        value: "hashed",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await openAccount(db, ana).requestDeletion();
      await openAccount(db, ana).requestExport();
      const jobs = accountJobs(db);
      const prefixes: string[] = [];
      const removeObjects = async (prefix: string) => {
        prefixes.push(prefix);
      };

      // Within the grace period: files and Memories go, the account waits.
      expect(await jobs.continueDeletion(ana, removeObjects)).toBe("waiting");
      expect(prefixes).toEqual([`users/${ana}/`]);
      expect(await count("memory", "user_id", ana)).toBe(0);
      expect(await count("memory_word", "user_id", ana)).toBe(0);
      expect(await count("ai_call", "user_id", ana)).toBe(0);
      expect(await count("user", "id", ana)).toBe(1);
      expect(await jobs.deletionsPending()).toContain(ana);

      await age(ana);
      expect(await jobs.continueDeletion(ana, removeObjects)).toBe("done");
      expect(prefixes).toHaveLength(2);
      for (const [table, column] of [
        ["user", "id"],
        ["session", "user_id"],
        ["account", "user_id"],
        ["library_export", "user_id"],
        ["account_deletion", "user_id"],
      ] as const) {
        expect(await count(table, column, ana), table).toBe(0);
      }
      expect(
        await count(
          "verification",
          "identifier",
          `sign-in-otp-library-${ana}@example.com`
        )
      ).toBe(0);
      expect(await jobs.deletionsPending()).not.toContain(ana);
      expect(await jobs.continueDeletion(ana, removeObjects)).toBe("none");

      // The money spent stays in the totals, without its owner.
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ai_call where user_id = ${ANONYMISED_USER} and cost_micros = 7`
      );
      expect(rows[0]!.n).toBeGreaterThan(0);

      // Ben is untouched.
      expect(await openLibrary(db, ben).get(bens.text)).toBeDefined();
      expect(await openLibrary(db, ben).get(bens.image)).toBeDefined();
      expect(await count("ai_call", "user_id", ben)).toBe(1);
      expect(await sessionsOf(ben)).toHaveLength(1);
    });

    it("ends a session a racing sign-in made, once the request commits", async () => {
      const ana = await person();
      // The sign-in passed the check and inserted its session while the
      // deletion request was still open.
      const racing = await signIn(ana);
      const { release, finished } = await holdOwnerLock(ana, async (tx) => {
        await tx.insert(schema.accountDeletion).values({ userId: ana });
      });
      const check = endSessionIfDeleting(db, ana, racing);
      expect(await stillWaiting(check)).toBe(true);
      release();
      await finished;
      expect(await check).toBe(true);
      expect(await sessionsOf(ana)).toEqual([]);

      const ben = await person();
      const kept = await signIn(ben);
      expect(await endSessionIfDeleting(db, ben, kept)).toBe(false);
      expect(await sessionsOf(ben)).toEqual([kept]);
    });

    it("records an AI call that finishes after deletion without its owner", async () => {
      const ana = await person();
      const memoryId = crypto.randomUUID();
      await recordCall(ana, memoryId);
      expect(await aiCallOwners(memoryId)).toEqual([ana]);

      // Being deleted: no new row names them.
      await openAccount(db, ana).requestDeletion();
      const during = crypto.randomUUID();
      await recordCall(ana, during);
      expect(await aiCallOwners(during)).toEqual([ANONYMISED_USER]);

      // The provider answers while the final step holds the owner's lock:
      // the call waits, then finds the person gone.
      const late = crypto.randomUUID();
      const { release, finished } = await holdOwnerLock(ana, async (tx) => {
        await tx.delete(schema.user).where(eq(schema.user.id, ana));
      });
      const call = recordCall(ana, late);
      expect(await stillWaiting(call)).toBe(true);
      release();
      await finished;
      await call;
      expect(await aiCallOwners(late)).toEqual([ANONYMISED_USER]);
      expect(await count("ai_call", "user_id", ana)).toBe(1);
    });

    it("keeps an admin's setting changes, without their id", async () => {
      const ana = await person();
      const key = `test-setting-${ana}`;
      await db
        .insert(schema.appSetting)
        .values({ key, value: "7", updatedBy: ana });
      await db
        .insert(schema.settingChange)
        .values({ key, previousValue: "5", value: "7", changedBy: ana });
      await openAccount(db, ana).requestDeletion();
      await age(ana);
      await accountJobs(db).continueDeletion(ana, async () => {});
      const [setting] = await db
        .select()
        .from(schema.appSetting)
        .where(eq(schema.appSetting.key, key));
      expect(setting).toMatchObject({ value: "7", updatedBy: ANONYMISED_USER });
      const changes = await db
        .select()
        .from(schema.settingChange)
        .where(eq(schema.settingChange.key, key));
      expect(changes).toMatchObject([
        { previousValue: "5", value: "7", changedBy: ANONYMISED_USER },
      ]);
      await db.delete(schema.appSetting).where(eq(schema.appSetting.key, key));
      await db
        .delete(schema.settingChange)
        .where(eq(schema.settingChange.key, key));
    });

    it("keeps other people's email codes, even one whose address ends like the person's", async () => {
      const ana = await person();
      const anaEmail = `library-${ana}@example.com`;
      const codes = {
        own: `sign-in-otp-${anaEmail}`,
        verify: `email-verification-otp-${anaEmail}`,
        victim: `sign-in-otp-x-otp-${anaEmail}`,
      };
      for (const identifier of Object.values(codes)) {
        await db.insert(schema.verification).values({
          id: crypto.randomUUID(),
          identifier,
          value: "hashed",
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
      await openAccount(db, ana).requestDeletion();
      await age(ana);
      await accountJobs(db).continueDeletion(ana, async () => {});
      expect(await count("verification", "identifier", codes.own)).toBe(0);
      expect(await count("verification", "identifier", codes.verify)).toBe(0);
      expect(await count("verification", "identifier", codes.victim)).toBe(1);
      await db
        .delete(schema.verification)
        .where(eq(schema.verification.identifier, codes.victim));
    });

    it("is idempotent if the job dies and runs again", async () => {
      const ana = await person();
      await fill(ana);
      await openAccount(db, ana).requestDeletion();
      await openAccount(db, ana).requestDeletion();
      const jobs = accountJobs(db);
      const failing = async () => {
        throw new Error("storage down");
      };
      await expect(jobs.continueDeletion(ana, failing)).rejects.toThrow();
      expect(await count("memory", "user_id", ana)).toBe(2);
      await age(ana);
      expect(await jobs.continueDeletion(ana, async () => {})).toBe("done");
      expect(await count("user", "id", ana)).toBe(0);
    });

    it("walks pending deletions oldest first, skipping ones already attempted", async () => {
      const ana = await person();
      const ben = await person();
      const cara = await person();
      const jobs = accountJobs(db);
      await openAccount(db, ana).requestDeletion();
      await openAccount(db, ben).requestDeletion();
      await openAccount(db, cara).requestDeletion();
      await db.execute(sql`
        delete from account_deletion
        where requested_at < now() - interval '20 days'
      `);
      await db
        .update(schema.accountDeletion)
        .set({ requestedAt: sql`now() - interval '3 days'` })
        .where(eq(schema.accountDeletion.userId, ana));
      await db
        .update(schema.accountDeletion)
        .set({ requestedAt: sql`now() - interval '2 days'` })
        .where(eq(schema.accountDeletion.userId, ben));
      await db
        .update(schema.accountDeletion)
        .set({ requestedAt: sql`now() - interval '1 day'` })
        .where(eq(schema.accountDeletion.userId, cara));
      await db.execute(
        sql`delete from app_setting where key = 'sweep_deletion_cursor'`
      );
      expect(await jobs.deletionsPending(1)).toEqual([ana]);
      expect(await jobs.deletionsPending(1)).toEqual([ben]);
      expect(await jobs.deletionsPending(1, [ben])).toEqual([cara]);
      await db.execute(
        sql`delete from app_setting where key = 'sweep_deletion_cursor'`
      );
    });

    it("clears the upload sweep cursor when it names the deleted person", async () => {
      const ana = await person();
      const ben = await person();
      const cara = await person();
      await db
        .insert(schema.appSetting)
        .values({ key: SWEEP_CURSOR_KEY, value: ben, updatedBy: "sweep" })
        .onConflictDoUpdate({
          target: schema.appSetting.key,
          set: { value: ben, updatedBy: "sweep" },
        });
      await openAccount(db, ana).requestDeletion();
      await age(ana);
      expect(await accountJobs(db).continueDeletion(ana, async () => {})).toBe(
        "done"
      );
      const kept = await db
        .select({ value: schema.appSetting.value })
        .from(schema.appSetting)
        .where(eq(schema.appSetting.key, SWEEP_CURSOR_KEY));
      expect(kept).toEqual([{ value: ben }]);

      await db
        .update(schema.appSetting)
        .set({ value: cara })
        .where(eq(schema.appSetting.key, SWEEP_CURSOR_KEY));
      await openAccount(db, cara).requestDeletion();
      await age(cara);
      expect(await accountJobs(db).continueDeletion(cara, async () => {})).toBe(
        "done"
      );
      expect(await count("app_setting", "key", SWEEP_CURSOR_KEY)).toBe(0);
    });
  });

  describe("export", () => {
    it("builds one at a time, leased to one builder, then ready", async () => {
      const ana = await person();
      const account = openAccount(db, ana);
      const jobs = accountJobs(db);
      const first = await account.requestExport();
      if (!("started" in first)) throw new Error("refused");
      expect(first.started).toMatchObject({ state: "building" });
      expect(await account.requestExport()).toEqual({ refused: "busy" });

      expect(await jobs.claimExport(first.started.id)).toEqual({
        userId: ana,
        attempt: 1,
        key: exportKey(ana, first.started.id, 1),
      });
      expect(await jobs.claimExport(first.started.id)).toBeUndefined();
      expect(await jobs.finishExport(first.started.id, 1, 1234)).toBe(true);
      expect(await account.export()).toMatchObject({
        id: first.started.id,
        state: "ready",
        bytes: 1234,
        key: exportKey(ana, first.started.id, 1),
      });
      // Not again within the cooldown.
      expect(await account.requestExport()).toEqual({ refused: "too_soon" });
      await db
        .update(schema.libraryExport)
        .set({ requestedAt: sql`now() - interval '2 hours'` })
        .where(eq(schema.libraryExport.userId, ana));
      const second = await account.requestExport();
      expect(second).toMatchObject({ started: { state: "building" } });
    });

    it("never loses a replaced export's ZIP: its removal is recorded with the replacement", async () => {
      const ana = await person();
      const account = openAccount(db, ana);
      const jobs = accountJobs(db);
      const first = await account.requestExport();
      if (!("started" in first)) throw new Error("refused");
      const claim = await jobs.claimExport(first.started.id);
      await jobs.finishExport(first.started.id, claim!.attempt, 10);
      await db
        .update(schema.libraryExport)
        .set({ requestedAt: sql`now() - interval '2 hours'` })
        .where(eq(schema.libraryExport.userId, ana));
      // The replacement commits; the Worker dies before removing anything.
      await account.requestExport();
      const old = claim!.key;
      const removed: string[] = [];
      const remove = async (keys: string[]) => void removed.push(...keys);

      // A finished attempt's object is never written again: due at once.
      expect(await count("object_removal", "key", old)).toBe(1);
      // Storage fails: the record stays for the next sweep.
      await expect(
        jobs.sweepExports(async () => {
          throw new Error("storage down");
        })
      ).rejects.toThrow();
      await jobs.sweepExports(remove);
      expect(removed).toContain(old);
      expect(await count("object_removal", "key", old)).toBe(0);
    });

    it("retries a failed build a few times, then fails for good, and can be asked again", async () => {
      const ana = await person();
      const account = openAccount(db, ana);
      const jobs = accountJobs(db);
      const request = await account.requestExport();
      if (!("started" in request)) throw new Error("refused");
      const { id } = request.started;
      for (const expected of ["retry", "retry", "failed"]) {
        expect(await jobs.claimExport(id)).toBeDefined();
        expect(await jobs.failExport(id)).toBe(expected);
      }
      expect(await jobs.claimExport(id)).toBeUndefined();
      expect(await account.export()).toMatchObject({ state: "failed" });
      expect(await account.requestExport()).toMatchObject({
        started: { state: "building" },
      });
    });

    it("sends lost builds again and removes expired exports", async () => {
      const ana = await person();
      const account = openAccount(db, ana);
      const jobs = accountJobs(db);
      const request = await account.requestExport();
      if (!("started" in request)) throw new Error("refused");
      const { id } = request.started;
      expect(await jobs.stalledExports()).not.toContain(id);
      await db
        .update(schema.libraryExport)
        .set({ requestedAt: sql`now() - interval '20 minutes'` })
        .where(eq(schema.libraryExport.id, id));
      expect(await jobs.stalledExports()).toContain(id);

      const claim = await jobs.claimExport(id);
      await jobs.finishExport(id, claim!.attempt, 10);
      await db
        .update(schema.libraryExport)
        .set({ readyAt: sql`now() - interval '25 hours'` })
        .where(eq(schema.libraryExport.id, id));
      expect(await account.export()).toBeUndefined();
      const removed: string[] = [];
      await jobs.sweepExports(async (keys) => void removed.push(...keys));
      expect(removed).toContain(claim!.key);
      expect(await count("library_export", "user_id", ana)).toBe(0);
    });

    it("drains every expired export in batches, and stops at its deadline to go on next time", async () => {
      const jobs = accountJobs(db);
      const owners = await Promise.all(
        Array.from({ length: 5 }, () => person())
      );
      const keys = owners.map((userId) =>
        exportKey(userId, crypto.randomUUID(), 1)
      );
      await db
        .insert(schema.objectRemoval)
        .values(
          keys.map((key) => ({ key, dueAt: sql`now() - interval '1 minute'` }))
        );
      const calls: string[][] = [];
      const remove = async (batch: string[]) => void calls.push(batch);
      // Past its deadline: one batch, then it stops.
      await jobs.sweepExports(remove, { batch: 2, deadline: 0 });
      expect(calls).toHaveLength(1);
      // The next run drains the rest, a batch at a time.
      await jobs.sweepExports(remove, { batch: 2 });
      const mine = calls.flat().filter((k) => keys.includes(k));
      expect(mine.sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(await count("object_removal", "key", key)).toBe(0);
      }
    });

    /** Starts an export for a new person and claims it, as the builder does. */
    async function claimed() {
      const ana = await person();
      const request = await openAccount(db, ana).requestExport();
      if (!("started" in request)) throw new Error("refused");
      const { id } = request.started;
      const claim = await accountJobs(db).claimExport(id);
      if (!claim) throw new Error("not claimed");
      return { ana, id, key: claim.key, attempt: claim.attempt };
    }
    const dueNow = (key: string) =>
      db.execute(
        sql`update object_removal set due_at = now() - interval '1 minute' where key = ${key}`
      );
    const sweptKeys = async () => {
      const removed: string[] = [];
      await accountJobs(db).sweepExports(
        async (keys) => void removed.push(...keys)
      );
      return removed;
    };

    it("removes the ZIP of a build that failed for good after its upload completed", async () => {
      const { id, key } = await claimed();
      const jobs = accountJobs(db);
      // Each upload completed, then the database step failed: three times.
      const keys = [key];
      expect(await jobs.failExport(id)).toBe("retry");
      keys.push((await jobs.claimExport(id))!.key);
      expect(await jobs.failExport(id)).toBe("retry");
      keys.push((await jobs.claimExport(id))!.key);
      expect(await jobs.failExport(id)).toBe("failed");
      expect(new Set(keys).size).toBe(3);
      // Not while a builder might still be writing it.
      const early = await sweptKeys();
      for (const k of keys) expect(early).not.toContain(k);
      for (const k of keys) await dueNow(k);
      const swept = await sweptKeys();
      for (const k of keys) {
        expect(swept).toContain(k);
        expect(await count("object_removal", "key", k)).toBe(0);
      }
    });

    it("removes the ZIP of a builder that died between completing the upload and recording it", async () => {
      const { key } = await claimed();
      // Nothing more happens: no finish, no failure recorded.
      expect(await sweptKeys()).not.toContain(key);
      await dueNow(key);
      expect(await sweptKeys()).toContain(key);
    });

    it("keeps a finished export's ZIP, however long the sweep waits", async () => {
      const { id, key, attempt } = await claimed();
      expect(await accountJobs(db).finishExport(id, attempt, 10)).toBe(true);
      await dueNow(key);
      expect(await sweptKeys()).not.toContain(key);
    });

    it("never deletes a retry's finished ZIP while a sweep is removing the abandoned attempt's", async () => {
      const { ana, id, key: abandoned } = await claimed();
      const jobs = accountJobs(db);
      // Attempt 1 completed its upload, then its builder died.
      const storage = new Set([abandoned]);
      await db
        .update(schema.libraryExport)
        .set({ leaseUntil: sql`now() - interval '1 minute'` })
        .where(eq(schema.libraryExport.userId, ana));
      await dueNow(abandoned);
      let finished: string | undefined;
      await jobs.sweepExports(async (keys) => {
        expect(keys).toContain(abandoned);
        // Paused between selecting and deleting: a retry claims, uploads
        // and finishes, then storage deletes what the sweep selected.
        const retry = await jobs.claimExport(id);
        storage.add(retry!.key);
        expect(await jobs.finishExport(id, retry!.attempt, 10)).toBe(true);
        finished = retry!.key;
        for (const key of keys) storage.delete(key);
      });
      expect(finished).not.toBe(abandoned);
      expect(await openAccount(db, ana).export()).toMatchObject({
        state: "ready",
        key: finished,
      });
      expect(storage.has(finished!)).toBe(true);
      expect(storage.has(abandoned)).toBe(false);
    });

    it("refuses to finish an attempt a newer one has taken over, and removes its ZIP", async () => {
      const { ana, id, key: stale, attempt } = await claimed();
      const jobs = accountJobs(db);
      await db
        .update(schema.libraryExport)
        .set({ leaseUntil: sql`now() - interval '1 minute'` })
        .where(eq(schema.libraryExport.userId, ana));
      const newer = await jobs.claimExport(id);
      // The first builder was only slow: it finishes after the takeover.
      expect(await jobs.finishExport(id, attempt, 10)).toBe(false);
      expect(await jobs.finishExport(id, newer!.attempt, 10)).toBe(true);
      expect(await openAccount(db, ana).export()).toMatchObject({
        key: newer!.key,
      });
      await dueNow(stale);
      expect(await sweptKeys()).toContain(stale);
    });

    it("sends again a build whose builder died on its first attempt", async () => {
      const { ana, id } = await claimed();
      await db
        .update(schema.libraryExport)
        .set({ leaseUntil: sql`now() - interval '1 minute'` })
        .where(eq(schema.libraryExport.userId, ana));
      expect(await accountJobs(db).stalledExports()).toContain(id);
      expect(await openAccount(db, ana).export()).toMatchObject({
        state: "building",
      });
    });

    it("returns only as many stalled exports as the sweep can send", async () => {
      const first = await claimed();
      const second = await claimed();
      await db
        .update(schema.libraryExport)
        .set({ leaseUntil: sql`now() - interval '1 minute'` })
        .where(eq(schema.libraryExport.userId, first.ana));
      await db
        .update(schema.libraryExport)
        .set({ leaseUntil: sql`now() - interval '1 minute'` })
        .where(eq(schema.libraryExport.userId, second.ana));
      const capped = await accountJobs(db).stalledExports(1);
      expect(capped).toHaveLength(1);
      const all = await accountJobs(db).stalledExports();
      expect(all.length).toBeGreaterThan(1);
      expect(all).toEqual(expect.arrayContaining([first.id, second.id]));
    });

    it("stops removing objects once its share of calls is spent", async () => {
      const jobs = accountJobs(db);
      const keys = [crypto.randomUUID(), crypto.randomUUID()].map(
        (id) => `users/budget/${id}/exports/one.zip`
      );
      await db
        .insert(schema.objectRemoval)
        .values(
          keys.map((key) => ({ key, dueAt: sql`now() - interval '1 minute'` }))
        );
      let left = 1;
      let calls = 0;
      try {
        await jobs.sweepExports(
          async () => {
            calls += 1;
          },
          {
            batch: 1,
            allowCall: () => {
              if (left <= 0) return false;
              left -= 1;
              return true;
            },
          }
        );
        expect(calls).toBe(1);
        const staying = (
          await Promise.all(
            keys.map((key) => count("object_removal", "key", key))
          )
        ).reduce((sum, n) => sum + n, 0);
        expect(staying).toBeGreaterThan(0);
      } finally {
        await db
          .delete(schema.objectRemoval)
          .where(eq(schema.objectRemoval.key, keys[0]!));
        await db
          .delete(schema.objectRemoval)
          .where(eq(schema.objectRemoval.key, keys[1]!));
      }
    });

    it("never builds for a person being deleted", async () => {
      const ana = await person();
      const request = await openAccount(db, ana).requestExport();
      if (!("started" in request)) throw new Error("refused");
      await openAccount(db, ana).requestDeletion();
      expect(await accountJobs(db).claimExport(request.started.id)).toBe(
        undefined
      );
    });

    it("pages through every Memory on the wall with its index and original", async () => {
      const ana = await person();
      const { text, image: img } = await fill(ana);
      const library = openLibrary(db, ana);
      const unfinished = await library.captureImage(image());
      if (!("memory" in unfinished)) throw new Error("not created");
      const first = await library.exportPage(undefined, 1);
      const second = await library.exportPage(first[0]!.id, 1);
      const rest = await library.exportPage(second[0]!.id, 1);
      expect(rest).toEqual([]);
      const all = [...first, ...second];
      expect(all.map((m) => m.id).sort()).toEqual([text, img].sort());
      expect(all.find((m) => m.id === text)).toMatchObject({
        body: "Lemon tart",
        index: { description: "A lemon tart", tags: ["baking"] },
        original: null,
      });
      expect(all.find((m) => m.id === img)).toMatchObject({
        index: null,
        original: {
          key: expect.stringMatching(
            new RegExp(`^users/${ana}/${img}/[0-9a-f-]{36}/original$`)
          ),
          mime: "image/png",
        },
      });
    });
  });
});
