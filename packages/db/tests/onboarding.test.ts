import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openDatabase,
  openLibrary,
  openOnboarding,
  indexingStore,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("first-run onboarding", () => {
  let db: Database;
  let close: () => Promise<void>;
  let owner: string;
  beforeAll(async () => {
    ({ db, close } = openDatabase(url!));
    owner = await newUser(db);
  });
  afterAll(async () => {
    await removeUser(db, owner);
    await close();
  });
  it("resumes server progress without seeding on read, and seeds once under concurrent starts", async () => {
    const flow = openOnboarding(db, owner);
    expect(await flow.read()).toMatchObject({
      step: "disclosure",
      paused: false,
    });
    expect((await openLibrary(db, owner).list())!.memories).toHaveLength(0);
    await Promise.all([flow.start(), flow.start()]);
    const samples = (await openLibrary(db, owner).list())!.memories;
    expect(samples).toHaveLength(3);
    expect(
      samples.every((m) => m.sample && m.indexState === "searchable")
    ).toBe(true);
    await flow.update("capture", true);
    expect(await openOnboarding(db, owner).read()).toMatchObject({
      step: "capture",
      paused: true,
    });
  });
  it("ignores a stale tab that skips the first step or reopens a finished flow", async () => {
    const fresh = await newUser(db);
    const flow = openOnboarding(db, fresh);
    expect(await flow.update("search", false)).toMatchObject({
      step: "disclosure",
      samplesSeeded: false,
    });
    expect((await openLibrary(db, fresh).list())!.memories).toHaveLength(0);
    await flow.start();
    await flow.update("done", true);
    expect(await flow.update("capture", false)).toMatchObject({
      step: "done",
      paused: true,
    });
    await removeUser(db, fresh);
  });
  it("keeps samples out of export, AI work and allowance, even after edits or opt-in", async () => {
    const library = openLibrary(db, owner);
    const sample = (await library.list())!.memories[0]!;
    expect(await library.exportPage()).toEqual([]);
    expect(await library.usedStorage()).toBe(0);
    await library.edit(sample.id, { body: "A revised example" });
    await library.setAiOptOut(sample.id, true);
    await library.setAiOptOut(sample.id, false);
    expect((await library.get(sample.id))!.indexState).toBe("searchable");
    expect(await indexingStore(db).load(sample.id)).toBeUndefined();
    expect(
      await indexingStore(db).loadForEmbedding(sample.id, "test@3")
    ).toBeUndefined();
  });
  it("records activation once across concurrent requests and rejects another owner's Memory", async () => {
    const other = await newUser(db);
    const result = await openLibrary(db, other).capture({
      body: "Other Library",
    });
    if (!("memory" in result)) throw new Error("capture failed");
    const flow = openOnboarding(db, owner);
    expect(await flow.activate(result.memory.id)).toBe(false);
    const id = (await openLibrary(db, owner).list())!.memories[0]!.id;
    expect(
      (await Promise.all([flow.activate(id), flow.activate(id)])).sort()
    ).toEqual([false, true]);
    expect((await flow.read()).firstSuccessfulSearchAt).toBeInstanceOf(Date);
    await removeUser(db, other);
  });
  it("removes samples in one action without deleting a real Capture or recreating samples", async () => {
    const library = openLibrary(db, owner);
    const saved = await library.capture({ body: "My own Memory" });
    if (!("memory" in saved)) throw new Error("capture failed");
    await Promise.all([
      openOnboarding(db, owner).removeSamples(),
      openOnboarding(db, owner).start(),
    ]);
    const remaining = (await library.list())!.memories;
    expect(remaining.map((m) => m.id)).toEqual([saved.memory.id]);
    await openOnboarding(db, owner).start();
    expect((await library.list())!.memories).toHaveLength(1);
  });
});
