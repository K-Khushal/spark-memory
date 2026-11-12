import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  indexedPages,
  type IndexingOutput,
  type PdfCapture,
} from "@spark/core";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// PDF Memories (#22) against real Postgres with migrations applied.
const databaseUrl = process.env.DATABASE_URL;

const MB = 1024 * 1024;
const DIMS = 768;
const MODEL = "test-embedding";

const pdf = (pages: number, over: Partial<PdfCapture> = {}): PdfCapture => ({
  id: crypto.randomUUID(),
  bytes: 40_000,
  contentHash: "cd".repeat(32),
  title: "Lease agreement",
  pages,
  width: 612,
  height: 792,
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: 300 },
  pageImages: Array.from({ length: indexedPages(pages) }, (_, i) => ({
    bytes: 1000 + i,
    width: 1024,
    height: 1325,
  })),
  ...over,
});

/** A unit vector along one axis. */
const axis = (i: number) =>
  Array.from({ length: DIMS }, (_, j) => (j === i ? 1 : 0));

const found = (over: Partial<IndexingOutput> = {}): IndexingOutput => ({
  title: "",
  description: "",
  ocrText: "",
  entities: [],
  tags: [],
  language: "en",
  ...over,
});

describe.skipIf(!databaseUrl)("PDF Memories", () => {
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

  async function stored(capture: PdfCapture, userId = ana) {
    const result = await library(userId).capturePdf(capture);
    if (!("memory" in result)) throw new Error("not created");
    const memory = await library(userId).markStored(capture.id);
    if (!memory || typeof memory === "string") throw new Error("not stored");
    return memory;
  }

  it("asks for the PDF, its thumbnail and an image of each Indexed page", async () => {
    const capture = pdf(3);
    const result = await library().capturePdf(capture);
    if (!("memory" in result)) throw new Error("refused");
    expect(result.created).toBe(true);
    expect(result.memory).toMatchObject({
      kind: "pdf",
      title: "Lease agreement",
      pages: 3,
      indexState: "indexing",
    });
    expect(result.uploads.map((u) => [u.role, u.page, u.mime])).toEqual([
      ["original", 0, "application/pdf"],
      ["thumbnail", 0, "image/webp"],
      ["page", 1, "image/jpeg"],
      ["page", 2, "image/jpeg"],
      ["page", 3, "image/jpeg"],
    ]);
    const keys = result.uploads.map((u) => u.key);
    expect(new Set(keys).size).toBe(5);
    expect(keys[2]).toMatch(
      new RegExp(`^users/${ana}/${capture.id}/[\\da-f-]+/page-1$`)
    );
    // Off the wall until every file is stored.
    expect((await library().list())!.memories.map((m) => m.id)).not.toContain(
      capture.id
    );
  });

  it("shows once every file is stored, with its pages for the viewer", async () => {
    const capture = pdf(2);
    const memory = await stored(capture);
    expect(memory.pages).toBe(2);
    expect(memory.image).toMatchObject({ mime: "application/pdf", width: 612 });
    expect((await library().list())!.memories.map((m) => m.id)).toContain(
      capture.id
    );
    const pages = await library().pageImages(capture.id);
    expect(pages?.map((p) => [p.page, p.width, p.height])).toEqual([
      [1, 1024, 1325],
      [2, 1024, 1325],
    ]);
    expect(await library(ben).pageImages(capture.id)).toBeUndefined();
  });

  it("keeps only the pages it Indexes of a long PDF, and says how long it is", async () => {
    const memory = await stored(pdf(120));
    expect(memory.pages).toBe(120);
    expect(await library().pageImages(memory.id)).toHaveLength(
      FREE_ALLOWANCE.pdfPagesIndexed
    );
  });

  it("gives a retry new keys for every file still missing, page by page", async () => {
    const capture = pdf(2);
    const first = await library().capturePdf(capture);
    const again = await library().capturePdf(capture);
    if (!("uploads" in first) || !("uploads" in again))
      throw new Error("refused");
    expect(again.created).toBe(false);
    const name = (u: { role: string; page: number }) => `${u.role}:${u.page}`;
    const before = new Map(first.uploads.map((u) => [name(u), u.key]));
    expect([...again.uploads.map(name)].sort()).toEqual(
      [...before.keys()].sort()
    );
    for (const upload of again.uploads) {
      const old = before.get(name(upload))!;
      expect(upload.key).not.toBe(old);
      expect(upload.key.split("/").pop()).toBe(old.split("/").pop());
    }
    // A confirm that checked the first attempt's objects cannot store this one.
    const checked = await library().markStored(capture.id, async (file) =>
      first.uploads.some((u) => u.key === file.key) ? "stored" : "missing"
    );
    expect(checked).toBe("missing");
  });

  it("will not take a PDF's id for an image, or another person's", async () => {
    const capture = pdf(1);
    await library().capturePdf(capture);
    expect(
      await library().captureImage({
        id: capture.id,
        mime: "image/png",
        bytes: 10,
        width: 1,
        height: 1,
        contentHash: "ab".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 10 },
      })
    ).toEqual({ conflict: true });
    expect(await library(ben).capturePdf(capture)).toEqual({ conflict: true });
  });

  it("counts the page images towards storage, and checks the PDF against the upload limit", async () => {
    const carl = await newUser(db);
    try {
      expect(
        await library(carl).capturePdf(
          pdf(1, { bytes: FREE_ALLOWANCE.maxUploadBytes + 1 })
        )
      ).toEqual({ refused: "file_too_large" });
      // Fill storage to within one page image of full.
      const filler = pdf(1, { bytes: 20 * MB });
      await stored(filler, carl);
      await db.execute(
        sql`update memory_file set bytes = ${FREE_ALLOWANCE.storageBytes - 19_000 - 1_300}
            where memory_id = ${filler.id} and role = 'original'`
      );
      // 18 kB of PDF fits; with its thumbnail and page image it does not.
      expect(await library(carl).capturePdf(pdf(1, { bytes: 18_000 }))).toEqual(
        { refused: "storage_full" }
      );
    } finally {
      await removeUser(db, carl);
    }
  });

  it("lets Indexing read the PDF and its pages, and keeps its text once", async () => {
    const memory = await stored(pdf(2));
    const loaded = await store().load(memory.id);
    expect(loaded).toMatchObject({
      pdf: {
        bytes: 40_000,
        pages: 2,
        pageImages: [
          { page: 1, mime: "image/jpeg" },
          { page: 2, mime: "image/jpeg" },
        ],
      },
    });
    const claim = { ...loaded!, memoryId: memory.id };
    expect(await store().savePdfText(claim, "Rent is due\fon the first")).toBe(
      true
    );
    expect(await store().savePdfText(claim, "again")).toBe(false);
    expect((await library().get(memory.id))?.body).toBe(
      "Rent is due\fon the first"
    );
    // A later run (Retry) cannot write as this one.
    await db.execute(
      sql`update memory set index_run = index_run + 1, body = null where id = ${memory.id}`
    );
    expect(await store().savePdfText(claim, "late")).toBe(false);
  });

  it("finds a PDF by its text, and says which page matched", async () => {
    const memory = await stored(pdf(2, { title: "Quarterly report" }));
    const loaded = (await store().load(memory.id))!;
    const claim = { ...loaded, memoryId: memory.id };
    await store().savePdfText(claim, "Intro\fThe heron nests by the weir");
    await store().complete(
      claim,
      { output: found({ title: "Report" }), model: "fake" },
      {
        model: MODEL,
        dimensions: DIMS,
        revision: loaded.revision,
        vectors: [
          { kind: "overview", embedding: axis(700) },
          { kind: "visual", anchor: { page: 2 }, embedding: axis(701) },
          {
            kind: "passage",
            anchor: { field: "body", start: 6, end: 31, page: 2 },
            embedding: axis(702),
          },
        ],
      }
    );
    const probe = (v: number[]) => ({
      model: MODEL,
      dimensions: DIMS,
      vector: v,
    });
    const [byLook] = await library().search("", { probe: probe(axis(701)) });
    expect(byLook).toMatchObject({
      id: memory.id,
      part: { kind: "visual", page: 2 },
    });
    const [byMeaning] = await library().search("", { probe: probe(axis(702)) });
    expect(byMeaning).toMatchObject({
      id: memory.id,
      part: { kind: "passage", field: "body", start: 6, end: 31, page: 2 },
    });
    const [byWord] = await library().search("heron");
    expect(byWord).toMatchObject({
      id: memory.id,
      part: { kind: "field", field: "text", page: 2 },
    });
  });
});
