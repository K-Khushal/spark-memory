import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TextCapture } from "@spark/core";
import { openDatabase, openLibrary, type Database } from "../index";
import { newUser, removeUser } from "./users";

// Integration test against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("a Library", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    ({ db, close } = openDatabase(databaseUrl!));
    ana = await newUser(db);
    ben = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, ana);
    await removeUser(db, ben);
    await close();
  });

  const library = (userId: string) => openLibrary(db, userId);
  /** A page of the Library (from a cursor it made). */
  const list = async (
    userId: string,
    options?: Parameters<ReturnType<typeof openLibrary>["list"]>[0]
  ) => (await library(userId).list(options))!;
  /** Captures and returns the new Memory. */
  const save = async (userId: string, input: TextCapture) => {
    const result = await library(userId).capture(input);
    if (!("memory" in result)) throw new Error("conflict");
    return result.memory;
  };

  describe("Capture", () => {
    it("saves pasted text as a text Memory waiting for Indexing, newest first", async () => {
      const first = await save(ana, { body: "First paste" });
      const second = await save(ana, {
        body: "Second paste",
        captureNote: "for the trip",
      });
      expect(second).toMatchObject({
        kind: "text",
        title: null,
        body: "Second paste",
        captureNote: "for the trip",
        indexState: "indexing",
        preservation: "preserved",
      });
      const { memories } = await list(ana);
      expect(memories.map((m) => m.id).slice(0, 2)).toEqual([
        second.id,
        first.id,
      ]);
    });

    it("keeps the id the client chose, and a retry returns the same Memory", async () => {
      const id = crypto.randomUUID();
      const first = await library(ana).capture({ id, body: "Sent twice" });
      const retry = await library(ana).capture({ id, body: "Sent twice" });
      expect(first).toMatchObject({ created: true, memory: { id } });
      expect(retry).toMatchObject({ created: false, memory: { id } });
    });
  });

  describe("list", () => {
    it("pages through the Library with a cursor", async () => {
      const owner = await newUser(db);
      for (const body of ["one", "two", "three"]) {
        await library(owner).capture({ body });
      }
      const page1 = await list(owner, { limit: 2 });
      const page2 = await list(owner, { limit: 2, after: page1.next });
      expect(page1.memories.map((m) => m.body)).toEqual(["three", "two"]);
      expect(page2.memories.map((m) => m.body)).toEqual(["one"]);
      expect(page2.next).toBeUndefined();
      // The cursor is one shape only: the Capture time in UTC microseconds.
      expect(page1.next).toMatch(/^\d{16}~[\da-f-]{36}$/);
      await removeUser(db, owner);
    });

    it("refuses a cursor it did not make", async () => {
      const uuid = crypto.randomUUID();
      for (const after of [
        "1~------------------------------------",
        `2026-13-45 99:99:99+00~${uuid}`,
        `2026-11-10 17:00:00+99~${uuid}`,
        `2026-11-10 17:00:00.123456+00~${uuid}`,
        `2026-11-10T17:00:00.123456Z~${uuid}`,
        `-1~${uuid}`,
        `99999999999999999999~${uuid}`,
        `1794330000000000~not-a-uuid`,
        "garbage",
      ]) {
        expect(await library(ana).list({ after }), after).toBeUndefined();
      }
    });
  });

  describe("edit", () => {
    it("changes title, body and Capture note and re-indexes the text", async () => {
      const memory = await save(ana, {
        body: "Grandma's lentil soup",
      });
      const edited = await library(ana).edit(memory.id, {
        title: "Dal",
        body: "Toor dal with tempered cumin",
        captureNote: "",
      });
      expect(edited).toMatchObject({
        title: "Dal",
        body: "Toor dal with tempered cumin",
        captureNote: null,
      });
      const ids = async (q: string) =>
        (await library(ana).search(q)).map((r) => r.id);
      expect(await ids("cumin")).toContain(memory.id);
      expect(await ids("lentil")).not.toContain(memory.id);
    });

    it("refuses an edit based on an older revision, so a late save never wins", async () => {
      const memory = await save(ana, { body: "Draft" });
      expect(memory.revision).toBe(1);
      const first = await library(ana).edit(memory.id, { title: "First" }, 1);
      expect(first).toMatchObject({ title: "First", revision: 2 });
      expect(await library(ana).edit(memory.id, { title: "Late" }, 1)).toEqual({
        stale: true,
      });
      expect((await library(ana).get(memory.id))?.title).toBe("First");
    });
  });

  describe("remove", () => {
    it("deletes a Memory permanently", async () => {
      const memory = await save(ana, { body: "Gone soon" });
      expect(await library(ana).remove(memory.id)).toBe(true);
      expect(await library(ana).get(memory.id)).toBeUndefined();
      expect(await library(ana).remove(memory.id)).toBe(false);
    });
  });

  describe("search", () => {
    let soup: string;
    beforeAll(async () => {
      ({ id: soup } = await save(ana, {
        title: "Smoky tomato soup",
        body: "Roast the tomatoes with paprika before blending.",
        captureNote: "winter dinners",
      }));
    });

    const top = async (userId: string, q: string) =>
      (await library(userId).search(q))[0];

    it("finds a Memory by a keyword in its title, body or Capture note", async () => {
      expect(await top(ana, "paprika")).toMatchObject({
        id: soup,
        matched: expect.arrayContaining(["keyword"]),
      });
      expect((await top(ana, "winter"))?.id).toBe(soup);
    });

    it("finds a Memory from the start of a word, as the person types", async () => {
      expect((await top(ana, "papr"))?.id).toBe(soup);
    });

    it("finds a Memory despite a typo", async () => {
      expect(await top(ana, "tomatoe papricka")).toMatchObject({
        id: soup,
        matched: expect.arrayContaining(["typo"]),
      });
    });

    it("finds a Memory from a first keystroke that is also a stop word", async () => {
      const { id } = await save(ana, { body: "Apple crumble" });
      const ids = (await library(ana).search("a")).map((r) => r.id);
      expect(ids).toContain(id);
    });

    it("returns nothing for an empty or punctuation-only query", async () => {
      expect(await library(ana).search("  ")).toEqual([]);
      expect(await library(ana).search("&|!:*()'")).toEqual([]);
    });
  });

  describe("is private to its owner", () => {
    let secret: string;
    beforeAll(async () => {
      ({ id: secret } = await save(ana, { body: "Ana's private passphrase" }));
    });

    it("another user cannot read, list or search it", async () => {
      expect(await library(ben).get(secret)).toBeUndefined();
      const { memories } = await list(ben, { limit: 500 });
      expect(memories.map((m) => m.id)).not.toContain(secret);
      expect(await library(ben).search("passphrase")).toEqual([]);
    });

    it("another user cannot edit or delete it", async () => {
      expect(
        await library(ben).edit(secret, { body: "overwritten" })
      ).toBeUndefined();
      expect(await library(ben).remove(secret)).toBe(false);
      expect((await library(ana).get(secret))?.body).toBe(
        "Ana's private passphrase"
      );
    });

    it("another user cannot take its id", async () => {
      expect(
        await library(ben).capture({ id: secret, body: "mine now" })
      ).toEqual({ conflict: true });
      expect((await library(ana).get(secret))?.body).toBe(
        "Ana's private passphrase"
      );
    });
  });

  it("goes when its owner's account is deleted", async () => {
    const owner = await newUser(db);
    const memory = await save(owner, { body: "Short-lived" });
    await removeUser(db, owner);
    // Its id is free again only if the row itself is gone.
    const reused = await library(ben).capture({ id: memory.id, body: "New" });
    expect(reused).toMatchObject({ created: true });
  });
});
