import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  type IndexingOutput,
  type LinkMetadata,
} from "@spark/core";
import {
  deepFetchStore,
  indexingStore,
  openDatabase,
  openImports,
  openLibrary,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// Text written in the background (Gather, a PDF's text, a transcript, a Deep
// fetch, what Indexing found, an import's title and note) takes storage like
// any text, through one check under the owner's lock. With no room it stores
// nothing of the derived text, keeps the Memory, and marks it partly Indexed:
// no job fails for it.
const databaseUrl = process.env.DATABASE_URL;
const PAGE = "Basil wants six hours of light and warm soil. ".repeat(20);

describe.skipIf(!databaseUrl)("background text and storage", () => {
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
  const store = () => indexingStore(db);
  const person = async () => {
    const id = await newUser(db);
    people.push(id);
    return { id, library: openLibrary(db, id) };
  };

  /** A Memory still Indexing, as Indexing took it: with its claim. */
  async function indexing(
    userId: string,
    kind: "text" | "link" | "video" | "pdf",
    extra: { body?: string; url?: string } = {}
  ) {
    const id = crypto.randomUUID();
    const { rows } = await db.execute<{
      generation: string;
      run: number;
      token: string;
    }>(sql`insert into memory (id, user_id, kind, body, source_url, source_url_normalised, index_state)
        values (${id}, ${userId}, ${kind}, ${extra.body ?? null}, ${extra.url ?? null}, ${extra.url ?? null}, 'indexing')
        returning index_generation as generation, index_run as run, '' as token`);
    return {
      memoryId: id,
      userId,
      generation: rows[0]!.generation,
      run: rows[0]!.run,
    };
  }
  const row = async (id: string) =>
    (
      await db.execute<{
        body: string | null;
        indexState: string;
        overAllowance: boolean;
        preservation: string;
        metadata: Record<string, unknown> | null;
        hasIndex: boolean;
      }>(sql`select body, index_state as "indexState", over_allowance as "overAllowance",
          preservation, metadata,
          exists (select 1 from memory_index i where i.memory_id = memory.id) as "hasIndex"
          from memory where id = ${id}`)
    ).rows[0]!;
  /** Fills the owner's storage with one stored file so `left` bytes remain. */
  async function fillUpTo(userId: string, left: number) {
    const holder = crypto.randomUUID();
    await db.execute(
      sql`insert into memory (id, user_id, kind, index_state) values (${holder}, ${userId}, 'image', 'searchable')`
    );
    const used = (
      await db.execute<{ n: string }>(
        sql`select coalesce(sum(octet_length(coalesce(body, ''))), 0)::text as n from memory where user_id = ${userId}`
      )
    ).rows[0]!.n;
    await db.execute(
      sql`insert into memory_file (memory_id, role, r2_key, mime, bytes, stored_at)
          values (${holder}, 'original', ${`k/${crypto.randomUUID()}`}, 'image/png',
            ${FREE_ALLOWANCE.storageBytes - left - Number(used)}, now())`
    );
  }
  const found = (ocrText = ""): { output: IndexingOutput; model: string } => ({
    output: {
      title: "Basil",
      description: "Growing basil",
      ocrText,
      entities: [],
      tags: ["garden"],
      language: "en",
    },
    model: "fake",
  });
  const full = (library: ReturnType<typeof openLibrary>) =>
    library.usedStorage();

  it("counts what Indexing found toward storage", async () => {
    const { id, library } = await person();
    const m = await indexing(id, "text", { body: "note" });
    const before = await full(library);
    await store().complete(m, found("x".repeat(500)));
    const after = await full(library);
    // title, description, ocr text and the tag: 500 + 5 + 13 + 6 bytes, and a space.
    expect(after - before).toBeGreaterThanOrEqual(500 + 5 + 13 + 6);
  });

  it("keeps a PDF without its text when storage is full, partly Indexed, and ends the run quietly", async () => {
    const { id } = await person();
    await fillUpTo(id, 100);
    const claim = await indexing(id, "pdf");
    expect(await store().savePdfText(claim, "Rent is due ".repeat(50))).toBe(
      false
    );
    expect(await row(claim.memoryId)).toMatchObject({
      body: null,
      indexState: "searchable",
      overAllowance: true,
    });
    // With room, it is kept as before.
    const { id: other } = await person();
    const ok = await indexing(other, "pdf");
    expect(await store().savePdfText(ok, "Rent is due")).toBe(true);
    expect(await row(ok.memoryId)).toMatchObject({
      body: "Rent is due",
      indexState: "indexing",
      overAllowance: false,
    });
  });

  it("keeps a gathered link as Reference only with its metadata when storage is full, never storing its text", async () => {
    const { id } = await person();
    await fillUpTo(id, 100);
    const claim = await indexing(id, "link", { url: "https://full.test/a" });
    const saved = await store().saveGathered(claim, {
      metadata: { title: "Basil guide" },
      text: PAGE,
    });
    expect(saved).toMatchObject({ body: null });
    expect(await row(claim.memoryId)).toMatchObject({
      body: null,
      preservation: "reference_only",
      indexState: "searchable",
      overAllowance: true,
      metadata: { title: "Basil guide" },
    });
  });

  it("stores no transcript when storage is full, and keeps the reel", async () => {
    const { id } = await person();
    await fillUpTo(id, 100);
    const claim = await indexing(id, "video", { url: "https://full.test/v" });
    expect(
      await store().copy.saveTranscript(claim, {
        duration: 30,
        transcript: [{ seconds: 1, text: PAGE }],
        transcriptState: "available",
        transcribedBy: "model",
      })
    ).toBeUndefined();
    const after = await row(claim.memoryId);
    expect(after).toMatchObject({
      body: null,
      indexState: "searchable",
      overAllowance: true,
    });
    expect(after.metadata?.video).toBeUndefined();
  });

  it("keeps what Indexing found out of the index when storage is full, but finishes the Memory partly Indexed", async () => {
    const { id } = await person();
    await fillUpTo(id, 100);
    const claim = await indexing(id, "text", { body: "note" });
    expect(await store().complete(claim, found("y".repeat(2000)))).toBe(true);
    expect(await row(claim.memoryId)).toMatchObject({
      indexState: "searchable",
      overAllowance: true,
      hasIndex: false,
    });
  });

  it("keeps a Deep fetch's text out when storage is full: the job is done, nothing is stored, no new Indexing", async () => {
    const { id } = await person();
    const token = crypto.randomUUID();
    const claimRow = await indexing(id, "link", {
      url: "https://deep-full.test/b",
    });
    await db.execute(
      sql`update memory set index_state = 'searchable', deep_fetch_state = 'running',
          deep_fetch_token = ${token}, deep_fetch_lease_until = now() + interval '5 minutes'
          where id = ${claimRow.memoryId}`
    );
    await fillUpTo(id, 100);
    const done = await deepFetchStore(db).done(
      { ...claimRow, token, run: 0 },
      { text: PAGE, metadata: { title: "Found" } }
    );
    expect(done).toMatchObject({ reindex: false });
    expect(await row(claimRow.memoryId)).toMatchObject({
      body: null,
      indexState: "searchable",
      overAllowance: true,
    });
  });

  it("keeps an import's link without its title and note when storage is full, partly Indexed, and the job goes on", async () => {
    const { id } = await person();
    await fillUpTo(id, 10);
    const jobs = openImports(db, id);
    const job = crypto.randomUUID();
    await jobs.create({ id: job, total: 1, spread: false });
    await jobs.append(job, {
      offset: 0,
      items: [
        {
          url: "https://import-full.test/a",
          title: "A title that does not fit",
          captureNote: "Nor does this note",
        },
      ],
    });
    await jobs.action(job, "start");
    expect(await jobs.step(job)).toBeUndefined();
    expect(await jobs.get(job)).toMatchObject({ state: "done", done: 1 });
    const { rows } = await db.execute<{
      title: string | null;
      note: string | null;
      over: boolean;
      state: string;
    }>(sql`select title, capture_note as note, over_allowance as over, index_state as state
        from memory where user_id = ${id} and source_url = 'https://import-full.test/a'`);
    expect(rows[0]).toEqual({
      title: null,
      note: null,
      over: true,
      state: "searchable",
    });
  });

  it("lets only as many parallel background writers store text as there is room for", async () => {
    const { id } = await person();
    // Room for one page of text, not two.
    const room = Buffer.byteLength(PAGE) + 100;
    await fillUpTo(id, room);
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        indexing(id, "link", { url: `https://parallel.test/${i}` })
      )
    );
    await Promise.all(
      claims.map((claim) =>
        store().saveGathered(claim, { metadata: {}, text: PAGE })
      )
    );
    const rows = await Promise.all(claims.map((c) => row(c.memoryId)));
    expect(rows.filter((r) => r.body !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.overAllowance)).toHaveLength(5);
    const { rows: used } = await db.execute<{ n: string }>(
      sql`select coalesce(sum(octet_length(coalesce(body, ''))), 0)::text as n from memory where user_id = ${id}`
    );
    expect(Number(used[0]!.n)).toBe(Buffer.byteLength(PAGE));
  });

  it("counts a Memory's metadata, a video's transcript in it, toward storage", async () => {
    const { id, library } = await person();
    const claim = await indexing(id, "video", { url: "https://meta.test/v" });
    const before = await library.usedStorage();
    await db.execute(
      sql`update memory set metadata = ${JSON.stringify({
        video: {
          transcript: [{ seconds: 1, text: PAGE }],
          transcriptState: "available",
        },
      })}::jsonb where id = ${claim.memoryId}`
    );
    expect((await library.usedStorage()) - before).toBeGreaterThanOrEqual(
      Buffer.byteLength(PAGE)
    );
  });

  it("leaves a video's transcript out of what Gather keeps when storage is full, keeping the rest of its metadata", async () => {
    const { id } = await person();
    await fillUpTo(id, 400);
    const claim = await indexing(id, "video", { url: "https://full.test/yt" });
    await store().saveGathered(claim, {
      metadata: {
        title: "Basil in a minute",
        video: {
          duration: 60,
          transcript: [{ seconds: 1, text: PAGE }],
          transcriptState: "available",
        },
      },
      text: null,
    });
    const after = await row(claim.memoryId);
    expect(after).toMatchObject({
      body: null,
      indexState: "searchable",
      overAllowance: true,
      metadata: {
        title: "Basil in a minute",
        video: {
          duration: 60,
          transcript: [],
          transcriptState: "over_allowance",
        },
      },
    });
    expect(JSON.stringify(after.metadata)).not.toContain("six hours");
  });

  it("measures a candidate's metadata as PostgreSQL stores it (jsonb::text), at the boundary where compact JSON would fit", async () => {
    const metadata: LinkMetadata = {
      video: {
        duration: 60,
        transcript: Array.from({ length: 40 }, (_, i) => ({
          seconds: i,
          text: "hi",
        })),
        transcriptState: "available",
      },
    };
    const compact = Buffer.byteLength(JSON.stringify(metadata));
    const stored = (
      await db.execute<{ n: string }>(
        sql`select octet_length(${JSON.stringify(metadata)}::jsonb::text)::text as n`
      )
    ).rows[0]!.n;
    // jsonb::text puts a space after every ':' and ',': it is larger.
    expect(Number(stored)).toBeGreaterThan(compact + 40);
    const gather = async (left: number, url: string) => {
      const { id } = await person();
      await fillUpTo(id, left);
      const claim = await indexing(id, "video", { url });
      await store().saveGathered(claim, { metadata, text: null });
      return row(claim.memoryId);
    };
    // Room for the compact form only: the stored form does not fit, so the
    // transcript is left out (it would have been kept by a compact count).
    const tight = await gather(compact, "https://boundary.test/tight");
    expect(tight).toMatchObject({
      overAllowance: true,
      metadata: {
        video: { transcript: [], transcriptState: "over_allowance" },
      },
    });
    // Room for exactly the stored form: kept.
    const exact = await gather(Number(stored), "https://boundary.test/exact");
    expect(exact).toMatchObject({
      overAllowance: false,
      metadata: { video: { transcriptState: "available" } },
    });
    // Usage counts the same bytes that admission did.
    const { id, library } = await person();
    const claim = await indexing(id, "video", {
      url: "https://boundary.test/usage",
    });
    const before = await library.usedStorage();
    await store().saveGathered(claim, { metadata, text: null });
    expect((await library.usedStorage()) - before).toBe(Number(stored));
  });

  it("keeps a video's transcript from Gather, as before, when there is room", async () => {
    const { id } = await person();
    const claim = await indexing(id, "video", { url: "https://roomy.test/yt" });
    await store().saveGathered(claim, {
      metadata: {
        video: {
          transcript: [{ seconds: 1, text: "Plants need sunlight." }],
          transcriptState: "available",
        },
      },
      text: null,
    });
    expect((await row(claim.memoryId)).metadata).toMatchObject({
      video: { transcriptState: "available" },
    });
  });

  it("counts a Deep fetch's transcript in the metadata as well as the body: room for the body alone is not enough", async () => {
    const { id } = await person();
    const token = crypto.randomUUID();
    const claimRow = await indexing(id, "video", {
      url: "https://deep-full.test/v",
    });
    await db.execute(
      sql`update memory set index_state = 'searchable', deep_fetch_state = 'running',
          deep_fetch_token = ${token}, deep_fetch_lease_until = now() + interval '5 minutes'
          where id = ${claimRow.memoryId}`
    );
    // Room for the transcript once (as the body), not twice (body and metadata).
    await fillUpTo(id, Buffer.byteLength(PAGE) + 300);
    const done = await deepFetchStore(db).done(
      { ...claimRow, token, run: 0 },
      {
        text: PAGE,
        transcript: [{ seconds: 1, text: PAGE }],
      }
    );
    expect(done).toMatchObject({ reindex: false });
    const after = await row(claimRow.memoryId);
    expect(after).toMatchObject({
      body: null,
      indexState: "searchable",
      overAllowance: true,
    });
    expect(JSON.stringify(after.metadata ?? {})).not.toContain("six hours");
  });

  it("stores the text, as before, when there is room", async () => {
    const { id } = await person();
    const claim = await indexing(id, "link", { url: "https://roomy.test/a" });
    await store().saveGathered(claim, {
      metadata: { title: "Basil" },
      text: PAGE,
    });
    expect(await row(claim.memoryId)).toMatchObject({
      body: PAGE,
      preservation: "preserved",
      overAllowance: false,
    });
  });
});
