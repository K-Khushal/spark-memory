import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { FREE_ALLOWANCE, type ReelCopy } from "@spark/core";
import {
  accountJobs,
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// A reel's user-provided copy (#20, ADR-0010) against real Postgres.
const databaseUrl = process.env.DATABASE_URL;

const copy = (over: Partial<ReelCopy> = {}): ReelCopy => ({
  bytes: 6_000_000,
  duration: 31,
  frames: [
    { seconds: 0, bytes: 30_000, width: 540, height: 960 },
    { seconds: 15.5, bytes: 31_000, width: 540, height: 960 },
  ],
  ...over,
});

describe.skipIf(!databaseUrl)("a reel's user-provided copy", () => {
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
    for (const id of [ana, ben]) {
      await db
        .delete(schema.objectRemoval)
        .where(
          sql`starts_with(${schema.objectRemoval.key}, ${`users/${id}/`})`
        );
      await removeUser(db, id);
    }
    await close();
  });

  const library = (userId = ana) => openLibrary(db, userId);
  const store = () => indexingStore(db);
  const reel = async (userId = ana, url?: string) => {
    const result = await library(userId).captureLink({
      url:
        url ??
        `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`,
    });
    if (!("memory" in result)) throw new Error("conflict");
    return result.memory;
  };
  const attach = async (id: string, input = copy(), userId = ana) => {
    const result = await library(userId).attachCopy(id, input);
    if (!result || !("uploads" in result)) throw new Error("not attached");
    return result;
  };
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
  /** Settles a Memory's Indexing, as a finished run would. */
  const settle = (id: string) =>
    db
      .update(schema.memory)
      .set({ indexState: "searchable" })
      .where(eq(schema.memory.id, id));
  const removals = async () => {
    const keys: string[] = [];
    await accountJobs(db).sweepExports(async (batch) => {
      keys.push(...batch);
    });
    return keys;
  };

  it("keeps what the extension read of a reel over what the public page says", async () => {
    const result = await library().captureLink({
      url: `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`,
      page: {
        description: "Sourdough in 60 seconds, from the screen",
        author: "@ana.bakes",
      },
    });
    if (!("memory" in result)) throw new Error("conflict");
    const claim = await claimOf(result.memory.id);
    await store().saveGathered(claim, {
      metadata: {
        description: "1,204 likes - a login wall",
        siteName: "Instagram",
        video: { transcript: [], transcriptState: "unavailable" },
      },
      text: null,
    });
    const kept = await library().get(result.memory.id);
    expect(kept).toMatchObject({
      description: "Sourdough in 60 seconds, from the screen",
      video: { transcriptState: "unavailable" },
    });
  });

  it("asks for the video and each frame, and leaves the reel visible meanwhile", async () => {
    const memory = await reel();
    expect(memory.kind).toBe("video");
    const { uploads } = await attach(memory.id);
    expect(uploads.map((u) => [u.role, u.page, u.mime])).toEqual([
      ["video", 0, "video/mp4"],
      ["frame", 0, "image/jpeg"],
      ["frame", 1, "image/jpeg"],
    ]);
    expect(
      uploads.every((u) => u.key.startsWith(`users/${ana}/${memory.id}/`))
    ).toBe(true);
    // Not a Memory file: an unfinished copy can neither hide the reel nor have it swept.
    expect(await library().files(memory.id)).toEqual([]);
    expect((await library().unfinished()).map((m) => m.id)).not.toContain(
      memory.id
    );
    expect((await library().list())!.memories.map((m) => m.id)).toContain(
      memory.id
    );
  });

  it("takes a copy only for the owner's own reel", async () => {
    const mine = await reel();
    const link = await library().captureLink({ url: "https://news.test/a" });
    if (!("memory" in link)) throw new Error("conflict");
    expect(await library(ben).attachCopy(mine.id, copy())).toBeUndefined();
    expect(await library().attachCopy(link.memory.id, copy())).toBeUndefined();
    expect(
      await library().attachCopy(crypto.randomUUID(), copy())
    ).toBeUndefined();
  });

  it("refuses a copy over the Free allowance, and one for a reel with AI opt-out", async () => {
    const big = await reel();
    expect(
      await library().attachCopy(
        big.id,
        copy({ bytes: FREE_ALLOWANCE.maxUploadBytes + 1 })
      )
    ).toEqual({ refused: "file_too_large" });
    const private_ = await reel();
    await library().setAiOptOut(private_.id, true);
    expect(await library().attachCopy(private_.id, copy())).toEqual({
      refused: "ai_opt_out",
    });
  });

  it("does nothing for a reel whose transcript is already kept", async () => {
    const memory = await reel();
    const claim = await claimOf(memory.id);
    await store().copy.saveTranscript(claim, {
      duration: 31,
      transcript: [{ seconds: 1, text: "hello" }],
      transcriptState: "available",
    });
    expect(await library().attachCopy(memory.id, copy())).toEqual({
      already: true,
    });
  });

  it("restarts Indexing only once every file is stored, and refuses a missing one", async () => {
    const memory = await reel();
    await settle(memory.id);
    const { uploads } = await attach(memory.id);
    const before = (await claimOf(memory.id)).run;
    expect(
      await library().markCopyStored(memory.id, async (f) =>
        f.role === "video" ? "missing" : "stored"
      )
    ).toBe("missing");
    expect((await claimOf(memory.id)).run).toBe(before);
    expect(
      await library().markCopyStored(memory.id, async (f) =>
        f.role === "frame" && f.page === 1 ? "mismatch" : "stored"
      )
    ).toBe("mismatch");
    const stored = await library().markCopyStored(
      memory.id,
      async () => "stored"
    );
    expect(stored).toMatchObject({ id: memory.id, indexState: "indexing" });
    expect((await claimOf(memory.id)).run).toBe(before + 1);
    expect(uploads).toHaveLength(3);
  });

  it("hands Indexing the stored copy, and nothing before it is stored", async () => {
    const memory = await reel();
    await attach(memory.id);
    const unstored = await store().load(memory.id);
    expect(unstored?.copy).toBeUndefined();
    await store().release(await claimOf(memory.id));
    await library().markCopyStored(memory.id, async () => "stored");
    const loaded = await store().load(memory.id);
    expect(loaded?.copy).toMatchObject({
      video: { mime: "video/mp4", bytes: 6_000_000, duration: 31 },
      frames: [
        { seconds: 0, mime: "image/jpeg" },
        { seconds: 15.5, mime: "image/jpeg" },
      ],
    });
  });

  it("keeps the transcript for the current run only", async () => {
    const memory = await reel();
    const claim = await claimOf(memory.id);
    const video = {
      duration: 31,
      transcript: [{ seconds: 2, text: "knead the dough" }],
      transcriptState: "available" as const,
      transcribedBy: "model" as const,
    };
    expect(
      await store().copy.saveTranscript({ ...claim, run: claim.run + 1 }, video)
    ).toBeUndefined();
    expect(await store().copy.saveTranscript(claim, video)).toEqual({
      transcript: video.transcript,
      body: "knead the dough",
    });
    const kept = await library().get(memory.id);
    expect(kept?.video).toEqual(video);
    expect(kept?.body).toBe("knead the dough");
    // Findable by what was said, and still Reference only.
    expect((await library().search("knead")).map((m) => m.id)).toContain(
      memory.id
    );
    expect(kept?.preservation).toBe("reference_only");
  });

  it("takes back the transcript and the copy when the person opts out of AI", async () => {
    const memory = await reel();
    const { uploads } = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    await store().copy.saveTranscript(await claimOf(memory.id), {
      duration: 31,
      transcript: [{ seconds: 2, text: "knead the dough" }],
      transcriptState: "available",
      transcribedBy: "model",
    });
    const off = await library().setAiOptOut(memory.id, true);
    expect(off).toMatchObject({
      body: null,
      video: { transcript: [], transcriptState: "unavailable" },
    });
    expect((await library().search("knead")).map((m) => m.id)).not.toContain(
      memory.id
    );
    expect(await library().attachCopy(memory.id, copy())).toEqual({
      refused: "ai_opt_out",
    });
    expect(await removals()).toEqual(
      expect.arrayContaining(uploads.map((u) => u.key))
    );
  });

  it("drops the copy for good: rows gone, every object queued for removal", async () => {
    const memory = await reel();
    const { uploads } = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    const generation = (await store().load(memory.id))!.copy!.generation;
    const keys = await store().copy.drop(await claimOf(memory.id), generation);
    expect(keys.toSorted()).toEqual(uploads.map((u) => u.key).toSorted());
    expect((await store().load(memory.id))?.copy).toBeUndefined();
    expect((await removals()).toSorted()).toEqual(expect.arrayContaining(keys));
  });

  it("drops only the generation Indexing read, so a copy attached since is kept", async () => {
    const memory = await reel();
    await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    const read = (await store().load(memory.id))!.copy!;
    await store().release(await claimOf(memory.id));
    // The person saves the reel again while that run is still going.
    const newer = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    expect(
      await store().copy.drop(await claimOf(memory.id), read.generation)
    ).toEqual([]);
    const kept = (await store().load(memory.id))!.copy!;
    expect(kept.generation).not.toBe(read.generation);
    expect(newer.uploads).toHaveLength(3);
  });

  it("answers a confirm sent twice, and a confirm for a copy that is gone", async () => {
    const memory = await reel();
    await attach(memory.id);
    const first = await library().markCopyStored(
      memory.id,
      async () => "stored"
    );
    const again = await library().markCopyStored(
      memory.id,
      async () => "stored"
    );
    expect(again).toMatchObject({ id: memory.id });
    expect(first).toMatchObject({ id: memory.id });
    await store().copy.drop(
      await claimOf(memory.id),
      (await store().load(memory.id))!.copy!.generation
    );
    expect(
      await library().markCopyStored(memory.id, async () => "stored")
    ).toBeUndefined();
  });

  it("queues the copy's objects when the Memory is deleted", async () => {
    const memory = await reel();
    const { uploads } = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    expect(await library().remove(memory.id)).toBe(true);
    expect(await removals()).toEqual(
      expect.arrayContaining(uploads.map((u) => u.key))
    );
  });

  it("sweeps a copy Indexing never got to", async () => {
    const memory = await reel();
    const { uploads } = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    await db
      .update(schema.memoryCopy)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(schema.memoryCopy.memoryId, memory.id));
    expect(await removals()).toEqual(
      expect.arrayContaining(uploads.map((u) => u.key))
    );
    expect((await store().load(memory.id))?.copy).toBeUndefined();
  });

  it("replaces an earlier copy, queuing its objects", async () => {
    const memory = await reel();
    const first = await attach(memory.id);
    await library().markCopyStored(memory.id, async () => "stored");
    const second = await attach(memory.id);
    expect(second.uploads.map((u) => u.key)).not.toEqual(
      first.uploads.map((u) => u.key)
    );
    expect(await removals()).toEqual(
      expect.arrayContaining(first.uploads.map((u) => u.key))
    );
  });
});
