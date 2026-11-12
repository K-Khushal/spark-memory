import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { requeueDeepFetches } from "../src/deep-fetch";
import { enqueueDeepFetch } from "../src/deep-fetch-queue";
import {
  databaseUrl,
  deepFetchQueue,
  drain,
  drainDeepFetch,
  env,
  fakeTurnstile,
  postSearch,
  signedIn,
} from "./worker";

// Deep fetch through the Worker: Gather comes back thin, the job is queued,
// the consumer fetches (the engine is the local script), Indexing starts over.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Memory = {
  id: string;
  indexState: string;
  preservation: string;
  body: string | null;
  deepFetch: string | null;
  deepFetchRun?: number;
  indexRun?: number;
};

const FAKE = { DEEP_FETCH_PROVIDER: "fake" } as const;

/** The web, where every page says almost nothing (a login wall, an app shell). */
function stubThinWeb() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") {
      return Response.json({
        Answer:
          url.searchParams.get("type") === "A"
            ? [{ type: 1, data: "93.184.215.14" }]
            : [],
      });
    }
    return new Response(
      "<html><title>Sign in</title><body>Log in</body></html>",
      {
        headers: { "content-type": "text/html" },
      }
    );
  });
}
afterEach(() => vi.restoreAllMocks());

/** A statement straight to the database, for what a test needs to age. */
async function sql(text: string, ...values: unknown[]) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function capture(call: Call, url: string) {
  const id = crypto.randomUUID();
  await call("/api/memories/links", { method: "POST", json: { id, url } });
  return id;
}
const read = async (call: Call, id: string) =>
  (await (await call(`/api/memories/${id}`)).json()) as Memory;
const searchIds = async (call: Call, q: string) =>
  (
    (await (await postSearch(call, { q })).json()) as {
      results: { id: string }[];
    }
  ).results.map((m) => m.id);

describe.skipIf(!databaseUrl)("Deep fetch", () => {
  it("fetches a Memory Gather found too little of, then Indexes what came back", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/post");
    await drain(id, env(FAKE));
    // Searchable at once by what little there was, and a Deep fetch is waiting.
    expect(await read(call, id)).toMatchObject({
      indexState: "searchable",
      preservation: "reference_only",
      body: null,
      deepFetch: "fetching",
    });
    expect(deepFetchQueue.sent.map((m) => m.body.memoryId)).toContain(id);

    const [message] = await drainDeepFetch(id, env(FAKE));
    expect(message!.ack).toHaveBeenCalled();
    // The page's own text is now the Memory's, and Indexing runs again.
    expect(await read(call, id)).toMatchObject({
      preservation: "preserved",
      indexState: "indexing",
      deepFetch: null,
    });
    await drain(id, env(FAKE));
    expect(await read(call, id)).toMatchObject({ indexState: "searchable" });
    expect(await searchIds(call, "Spark found these words")).toContain(id);
  });

  it("never queues a Deep fetch for a Source that is not on the public web", async () => {
    const { call } = await signedIn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "cloudflare-dns.com")
        return new Response("", { status: 404 });
      return Response.json({
        Answer:
          url.searchParams.get("type") === "A"
            ? [{ type: 1, data: "10.0.0.7" }]
            : [],
      });
    });
    const id = await capture(call, "https://intranet.corp.test/wiki");
    await drain(id, env(FAKE));
    expect(await read(call, id)).toMatchObject({
      indexState: "searchable",
      preservation: "reference_only",
      deepFetch: null,
    });
    expect(deepFetchQueue.sent.map((m) => m.body.memoryId)).not.toContain(id);
  });

  it("never exposes the queue's run or generation to the client", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/secret");
    await drain(id, env(FAKE));
    const memory = await read(call, id);
    expect(memory).not.toHaveProperty("deepFetchRun");
    expect(memory).not.toHaveProperty("indexGeneration");
    const list = (await (await call("/api/memories")).json()) as {
      memories: object[];
    };
    for (const m of list.memories) expect(m).not.toHaveProperty("deepFetchRun");
  });

  it("shows Unavailable with no engine configured, and Try Again fetches once one is", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/later");
    await drain(id, env());
    await drainDeepFetch(id, env());
    expect(await read(call, id)).toMatchObject({ deepFetch: "unavailable" });

    // Try Again without an engine is Unavailable again, not a crash.
    const again = await call(`/api/memories/${id}/deep-fetch`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ deepFetch: "fetching" });
    await drainDeepFetch(id, env());
    expect(await read(call, id)).toMatchObject({ deepFetch: "unavailable" });

    await call(`/api/memories/${id}/deep-fetch`, { method: "POST" });
    await drainDeepFetch(id, env(FAKE));
    expect(await read(call, id)).toMatchObject({
      preservation: "preserved",
      deepFetch: null,
    });
  });

  it("answers Try Again only for the owner, and does nothing for a Memory that is not Failed", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/mine");
    await drain(id, env(FAKE));
    expect(
      (await other.call(`/api/memories/${id}/deep-fetch`, { method: "POST" }))
        .status
    ).toBe(404);
    expect(
      (await call("/api/memories/not-a-uuid/deep-fetch", { method: "POST" }))
        .status
    ).toBe(404);
    // Still queued, not Failed: nothing new is sent.
    const before = deepFetchQueue.sent.length;
    await call(`/api/memories/${id}/deep-fetch`, { method: "POST" });
    expect(deepFetchQueue.sent.length).toBe(before);
  });

  it("sends what is due but was never delivered, once an hour", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/lost");
    await drain(id, env(FAKE));
    // The message is lost.
    deepFetchQueue.sent = deepFetchQueue.sent.filter(
      (m) => m.body.memoryId !== id
    );
    await sql(
      "update memory set deep_fetch_due_at = now() - interval '1 minute' where id = $1",
      id
    );
    await requeueDeepFetches(env(FAKE));
    expect(deepFetchQueue.sent.map((m) => m.body.memoryId)).toContain(id);
    await drainDeepFetch(id, env(FAKE));
    expect(await read(call, id)).toMatchObject({ preservation: "preserved" });
  });

  it("sends a wait a queue can hold as a delayed message, and leaves a longer one to the sweep", async () => {
    const target = {
      memoryId: crypto.randomUUID(),
      generation: crypto.randomUUID(),
      run: 0,
    };
    const before = deepFetchQueue.sent.length;
    await enqueueDeepFetch(env(), { ...target, delaySeconds: 3600 });
    await enqueueDeepFetch(env(), { ...target, delaySeconds: 20 * 86400 });
    expect(deepFetchQueue.sent.slice(before)).toEqual([
      { body: target, delaySeconds: 3600 },
    ]);
  });

  it("shows a Memory queued for later as Waiting, and skips a message that arrives early", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/wait");
    await drain(id, env(FAKE));
    await sql(
      "update memory set deep_fetch_due_at = now() + interval '20 days' where id = $1",
      id
    );
    expect(await read(call, id)).toMatchObject({ deepFetch: "waiting" });
    const [message] = await drainDeepFetch(id, env(FAKE));
    expect(message!.ack).toHaveBeenCalled();
    expect(await read(call, id)).toMatchObject({
      deepFetch: "waiting",
      preservation: "reference_only",
    });
  });
});
