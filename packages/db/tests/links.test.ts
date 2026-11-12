import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { LinkCapture } from "@spark/core";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Link Memories against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

const ARTICLE = "Basil wants six hours of light and warm soil. ".repeat(10);

describe.skipIf(!databaseUrl)("link Memories", () => {
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

  const library = (userId = ana) => openLibrary(db, userId);
  const store = () => indexingStore(db);
  const link = async (input: LinkCapture, userId = ana) => {
    const result = await library(userId).captureLink(input);
    if (!("memory" in result)) throw new Error("conflict");
    return result;
  };
  it("resurfaces the same video with its latest playback Source", async () => {
    const first = await link({
      url: "https://www.youtube.com/watch?v=extension-round1&t=10s",
      page: { title: "Basil" },
    });
    const second = await link({
      url: "https://www.youtube.com/watch?v=extension-round1&t=42s",
      page: { title: "Basil" },
    });
    expect(second.memory.id).toBe(first.memory.id);
    expect(second).toMatchObject({
      duplicate: true,
      memory: {
        sourceUrl: "https://www.youtube.com/watch?v=extension-round1&t=42s",
      },
    });
  });
  const claimOf = async (memoryId: string) => {
    const [row] = await db
      .select({
        userId: schema.memory.userId,
        generation: schema.memory.indexGeneration,
        run: schema.memory.indexRun,
      })
      .from(schema.memory)
      .where(eq(schema.memory.id, memoryId));
    return { memoryId, ...row! };
  };
  const gathered = (over = {}) => ({
    metadata: {
      title: "Growing Basil Indoors",
      description: "A short guide to light",
      siteName: "Garden Weekly",
    },
    text: ARTICLE,
    contentHash: "a".repeat(64),
    ...over,
  });

  it("Captures a link Indexing, Reference only until something is kept", async () => {
    const { memory, created } = await link({
      id: crypto.randomUUID(),
      url: "https://Garden.test/basil?utm_source=news#top",
      captureNote: "for the windowsill",
    });
    expect(created).toBe(true);
    expect(memory).toMatchObject({
      kind: "link",
      sourceUrl: "https://Garden.test/basil?utm_source=news#top",
      title: null,
      body: null,
      captureNote: "for the windowsill",
      preservation: "reference_only",
      indexState: "indexing",
      pageTitle: null,
      description: null,
    });
    // Findable by its host straight away.
    expect((await library().search("garden")).map((m) => m.id)).toContain(
      memory.id
    );
  });

  it("resurfaces the Memory already saved for the same page, and moves it to the top", async () => {
    const first = await link({ url: "https://news.test/a?id=1&utm_medium=x" });
    const other = await link({ url: "https://news.test/b" });
    const again = await link({
      id: crypto.randomUUID(),
      url: "https://NEWS.test/a?fbclid=1&id=1",
      captureNote: "still good",
    });
    expect(again.created).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.memory.id).toBe(first.memory.id);
    // The note fills in only where there was none.
    expect(again.memory.captureNote).toBe("still good");
    expect(new Date(again.memory.lastSavedAt).getTime()).toBeGreaterThan(
      new Date(first.memory.lastSavedAt).getTime()
    );
    const { memories } = (await library().list())!;
    const ids = memories.map((m) => m.id);
    expect(ids.indexOf(first.memory.id)).toBeLessThan(
      ids.indexOf(other.memory.id)
    );
  });

  it("keeps the Capture note already there", async () => {
    const first = await link({ url: "https://note.test/", captureNote: "one" });
    const again = await link({ url: "https://note.test/", captureNote: "two" });
    expect(again.memory.id).toBe(first.memory.id);
    expect(again.memory.captureNote).toBe("one");
  });

  it("answers a retry with the same id as the same Capture, not a duplicate", async () => {
    const id = crypto.randomUUID();
    await link({ id, url: "https://retry.test/" });
    const retry = await link({ id, url: "https://retry.test/" });
    expect(retry).toMatchObject({ created: false, memory: { id } });
    expect(retry.duplicate).toBeUndefined();
  });

  it("keeps the same page apart for different people", async () => {
    const mine = await link({ url: "https://shared.test/" });
    const theirs = await link({ url: "https://shared.test/" }, ben);
    expect(theirs.created).toBe(true);
    expect(theirs.memory.id).not.toBe(mine.memory.id);
  });

  it("refuses an id another person's Memory has", async () => {
    const theirs = await link({ url: "https://ben.test/" }, ben);
    expect(
      await library().captureLink({
        id: theirs.memory.id,
        url: "https://x.test/",
      })
    ).toEqual({ conflict: true });
  });

  it("refuses links that are not http(s)", async () => {
    await expect(
      library().captureLink({ url: "javascript:alert(1)" })
    ).rejects.toThrow();
  });

  it("loads a link for Indexing with its Source, until it is gathered", async () => {
    const { memory } = await link({ url: "https://load.test/" });
    expect(await store().load(memory.id)).toMatchObject({
      kind: "link",
      sourceUrl: "https://load.test/",
      gathered: false,
    });
  });

  it("keeps what gathering found: Preserved with text, searchable by title, description, text and host", async () => {
    const { memory } = await link({
      url: "https://www.gardenweekly.test/basil",
    });
    const claim = await claimOf(memory.id);
    const saved = await store().saveGathered(claim, gathered());
    expect(saved).toMatchObject({
      pageTitle: "Growing Basil Indoors",
      description: "A short guide to light",
      body: ARTICLE,
    });
    const now = (await library().get(memory.id))!;
    expect(now).toMatchObject({
      preservation: "preserved",
      pageTitle: "Growing Basil Indoors",
      description: "A short guide to light",
      body: ARTICLE,
      title: null,
    });
    const find = async (q: string) =>
      (await library().search(q)).find((m) => m.id === memory.id);
    expect((await find("basil indoors"))?.part).toMatchObject({
      field: "title",
    });
    expect((await find("guide"))?.part).toMatchObject({ field: "description" });
    expect((await find("soil"))?.part).toMatchObject({ field: "text" });
    expect((await find("gardenweekly"))?.part).toMatchObject({
      field: "source",
    });
  });

  it("stays Reference only when no text was kept", async () => {
    const { memory } = await link({ url: "https://thin.test/" });
    await store().saveGathered(await claimOf(memory.id), {
      metadata: { title: "Sign in" },
      text: null,
    });
    expect(await library().get(memory.id)).toMatchObject({
      preservation: "reference_only",
      body: null,
      pageTitle: "Sign in",
    });
  });

  it("writes nothing for a run that moved on, or for a gathered link", async () => {
    const { memory } = await link({ url: "https://late.test/" });
    const claim = await claimOf(memory.id);
    await library().setAiOptOut(memory.id, true);
    await library().setAiOptOut(memory.id, false);
    expect(await store().saveGathered(claim, gathered())).toBeUndefined();
    const current = await claimOf(memory.id);
    expect(
      await store().saveGathered(
        current,
        gathered({ contentHash: "b".repeat(64) })
      )
    ).toBeDefined();
    expect(await store().saveGathered(current, gathered())).toBeUndefined();
  });

  it("keeps a second link with the same text, without its content hash", async () => {
    const a = await link({ url: "https://same.test/1" });
    const b = await link({ url: "https://same.test/2" });
    const hash = { contentHash: "c".repeat(64) };
    await store().saveGathered(await claimOf(a.memory.id), gathered(hash));
    expect(
      await store().saveGathered(await claimOf(b.memory.id), gathered(hash))
    ).toBeDefined();
    const [row] = await db
      .select({ hash: schema.memory.contentHash })
      .from(schema.memory)
      .where(eq(schema.memory.id, b.memory.id));
    expect(row!.hash).toBeNull();
  });

  it("keeps both links when two with the same text are gathered at once", async () => {
    const hash = { contentHash: "d".repeat(64) };
    const pair = await Promise.all([
      link({ url: "https://race.test/1" }),
      link({ url: "https://race.test/2" }),
    ]);
    const claims = await Promise.all(pair.map((p) => claimOf(p.memory.id)));
    const saved = await Promise.all(
      claims.map((c) => store().saveGathered(c, gathered(hash)))
    );
    expect(saved.every(Boolean)).toBe(true);
    const rows = await db
      .select({ hash: schema.memory.contentHash })
      .from(schema.memory)
      .where(eq(schema.memory.contentHash, hash.contentHash));
    expect(rows).toHaveLength(1);
  });

  it("exports a link with its Source, Preservation and what gathering found", async () => {
    const { memory } = await link({
      url: "https://export.test/a?utm_source=x",
    });
    await store().saveGathered(
      await claimOf(memory.id),
      gathered({ contentHash: "e".repeat(64) })
    );
    const thin = await link({ url: "https://export.test/thin" });
    const all: Awaited<ReturnType<ReturnType<typeof library>["exportPage"]>> =
      [];
    for (let after: string | undefined; ;) {
      const page = await library().exportPage(after);
      if (!page.length) break;
      all.push(...page);
      after = page.at(-1)!.id;
    }
    expect(all.find((m) => m.id === memory.id)).toMatchObject({
      kind: "link",
      sourceUrl: "https://export.test/a?utm_source=x",
      preservation: "preserved",
      body: ARTICLE,
      metadata: {
        title: "Growing Basil Indoors",
        description: "A short guide to light",
        siteName: "Garden Weekly",
      },
    });
    expect(all.find((m) => m.id === thin.memory.id)).toMatchObject({
      sourceUrl: "https://export.test/thin",
      preservation: "reference_only",
      metadata: null,
    });
  });

  it("never lets a link's text be edited", async () => {
    const { memory } = await link({ url: "https://edit.test/" });
    expect(
      await library().edit(memory.id, { body: "mine now" })
    ).toBeUndefined();
    expect(
      await library().edit(memory.id, { title: "My title" })
    ).toMatchObject({
      title: "My title",
    });
  });
});
