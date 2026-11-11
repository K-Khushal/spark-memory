import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { ImageCapture } from "@spark/core";
import {
  accountJobs,
  ANONYMISED_USER,
  exportKey,
  isDeletionRequested,
  openAccount,
  openDatabase,
  openLibrary,
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
  });

  describe("export", () => {
    it("builds one at a time, leased to one builder, then ready", async () => {
      const ana = await person();
      const account = openAccount(db, ana);
      const jobs = accountJobs(db);
      const first = await account.requestExport();
      if (!("started" in first)) throw new Error("refused");
      expect(first.started).toMatchObject({ state: "building" });
      expect(first.replaced).toBeUndefined();
      expect(await account.requestExport()).toEqual({ refused: "busy" });

      expect(await jobs.claimExport(first.started.id)).toEqual({
        userId: ana,
        key: exportKey(ana, first.started.id),
      });
      expect(await jobs.claimExport(first.started.id)).toBeUndefined();
      expect(await jobs.finishExport(first.started.id, 1234)).toBe(true);
      expect(await account.export()).toMatchObject({
        id: first.started.id,
        state: "ready",
        bytes: 1234,
      });
      // Not again within the cooldown.
      expect(await account.requestExport()).toEqual({ refused: "too_soon" });
      await db
        .update(schema.libraryExport)
        .set({ requestedAt: sql`now() - interval '2 hours'` })
        .where(eq(schema.libraryExport.userId, ana));
      const second = await account.requestExport();
      expect(second).toMatchObject({
        started: { state: "building" },
        replaced: exportKey(ana, first.started.id),
      });
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

      await jobs.claimExport(id);
      await jobs.finishExport(id, 10);
      await db
        .update(schema.libraryExport)
        .set({ readyAt: sql`now() - interval '25 hours'` })
        .where(eq(schema.libraryExport.id, id));
      expect(await account.export()).toBeUndefined();
      const removed: string[] = [];
      await jobs.removeExpiredExports(async (key) => void removed.push(key));
      expect(removed).toContain(exportKey(ana, id));
      expect(await count("library_export", "user_id", ana)).toBe(0);
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
        original: { key: `users/${ana}/${img}/original`, mime: "image/png" },
      });
    });
  });
});
