import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { INDEXING } from "@spark/core";
import { requeueStalled } from "../src/indexing";
import { requeueDeepFetches } from "../src/deep-fetch";
import { enqueueDeepFetch } from "../src/deep-fetch-queue";
import {
  databaseUrl,
  deepFetchQueue,
  drain,
  deliver,
  queues,
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
  it.each([503, 403, 401])(
    "recovers transient Sources once after 24 hours, but never retries refused ones (%s)",
    async (status) => {
      const { call } = await signedIn();
      let recovered = false;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        return url.hostname === "cloudflare-dns.com"
          ? Response.json({
              Answer:
                url.searchParams.get("type") === "A"
                  ? [{ type: 1, data: "93.184.215.14" }]
                  : [],
            })
          : recovered
            ? new Response(
                "<html><body>" +
                  "A recovered public article about basil and warm sunny gardens. ".repeat(
                    20
                  ) +
                  "</body></html>",
                { headers: { "content-type": "text/html" } }
              )
            : new Response("", { status });
      });
      const id = await capture(call, `https://unreachable-${status}.test/post`);
      const initial = queues.fresh.sent.find(
        (m) => m.body.memoryId === id
      )!.body;
      const first = await deliver(queues.fresh.name, initial, 1, env(FAKE));
      if (status === 503) {
        expect(first.retry).toHaveBeenCalled();
        await deliver(
          queues.fresh.name,
          initial,
          INDEXING.maxAttempts,
          env(FAKE)
        );
        expect(await read(call, id)).toMatchObject({
          preservation: "reference_only",
          deepFetch: null,
        });
        expect(deepFetchQueue.sent.some((m) => m.body.memoryId === id)).toBe(
          false
        );
        const sent = () =>
          queues.background.sent.filter((m) => m.body.memoryId === id);
        await requeueStalled(env(FAKE));
        expect(sent()).toHaveLength(0);
        await sql(
          "update memory set gather_retry_at = now() - interval '1 minute' where id = $1",
          id
        );
        await requeueStalled(env(FAKE));
        expect(sent()).toHaveLength(1);
        recovered = true;
        const recovery = await deliver(
          queues.background.name,
          sent()[0]!.body,
          1,
          env(FAKE)
        );
        expect(recovery.retry).not.toHaveBeenCalled();
        expect(await read(call, id)).toMatchObject({
          preservation: "preserved",
        });
        await requeueStalled(env(FAKE));
        expect(sent()).toHaveLength(1);
        expect(deepFetchQueue.sent.some((m) => m.body.memoryId === id)).toBe(
          false
        );
      } else {
        expect(first.retry).not.toHaveBeenCalled();
        expect(await read(call, id)).toMatchObject({
          preservation: "reference_only",
          deepFetch: null,
        });
        expect(deepFetchQueue.sent.some((m) => m.body.memoryId === id)).toBe(
          false
        );
      }
    }
  );

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

  it("shows nothing with no engine configured, and Try Again cannot change that", async () => {
    const { call } = await signedIn();
    stubThinWeb();
    const id = await capture(call, "https://app.test/later");
    await drain(id, env());
    await drainDeepFetch(id, env());
    // Unavailable is stored, never shown: it is the operator's to fix.
    expect(await read(call, id)).toMatchObject({
      deepFetch: null,
      preservation: "reference_only",
    });
    const before = deepFetchQueue.sent.length;
    const again = await call(`/api/memories/${id}/deep-fetch`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ deepFetch: null });
    expect(deepFetchQueue.sent.length).toBe(before);
  });

  it("leaves out a fetcher it would not trust: plain http, or a weak token", async () => {
    const strong = "a-strong-shared-token-0123456789-abcdef";
    const trusted = {
      FETCHER_URL: "https://fetcher.example.test",
      FETCHER_TOKEN: strong,
    };
    const cases = [
      { FETCHER_URL: "http://fetcher.example.test", FETCHER_TOKEN: strong },
      { FETCHER_URL: trusted.FETCHER_URL, FETCHER_TOKEN: "short" },
    ];
    // Signed in before the web is stubbed: the stub answers every fetch.
    const people = await Promise.all([signedIn(), signedIn(), signedIn()]);
    stubThinWeb();
    const video = "https://www.youtube.com/watch?v=abcdefghijk";
    for (const [i, over] of cases.entries()) {
      const { call } = people[i]!;
      const id = await capture(call, video);
      await drain(id, env(over));
      await drainDeepFetch(id, env(over));
      // Nothing was asked of it: Unavailable, which shows nothing.
      expect(await read(call, id)).toMatchObject({ deepFetch: null });
    }
    // A fetcher it does trust is asked, and its failure waits for the next attempt.
    const { call } = people[2]!;
    const id = await capture(call, video);
    await drain(id, env(trusted));
    await drainDeepFetch(id, env(trusted));
    expect(await read(call, id)).toMatchObject({ deepFetch: "waiting" });
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
