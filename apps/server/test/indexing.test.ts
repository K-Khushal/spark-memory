import { describe, expect, it, vi } from "vitest";
import { EMBEDDING, INDEXING } from "@spark/core";
import { FAKE_WORD } from "@spark/indexing";
import worker from "../src/index";
import type { Bindings } from "../src/env";
import {
  ctx,
  databaseUrl,
  deliver,
  drain,
  env,
  fakeTurnstile,
  ORIGIN,
  queues,
  signedIn,
} from "./worker";

// Indexing through the Worker: Capture over HTTP, the queue consumer, real
// Postgres. Providers are stubbed at their boundary: the Workers AI binding
// and Gemini's HTTP API (fetch).
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Memory = {
  id: string;
  indexState: string;
  indexError: string | null;
  indexTitle: string | null;
  aiOptOut: boolean;
};

const answer = (over: object = {}) =>
  JSON.stringify({
    title: "Citrus dessert",
    description: "A tart with a glossy zesty filling",
    ocrText: "",
    entities: [],
    tags: ["baking"],
    language: "en",
    ...over,
  });

/** The Workers AI binding, answering each call from `replies` in turn. */
function gemma(...replies: (string | Error)[]) {
  return {
    run: vi.fn(async (_model: string, _input: Record<string, unknown>) => {
      const next = replies.shift() ?? new Error("5000: unavailable");
      if (next instanceof Error) throw next;
      return {
        choices: [{ message: { content: next } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      };
    }),
  };
}

/** Gemini's API behind fetch, answering each call from `replies` in turn. */
function geminiApi(...replies: (string | number)[]) {
  const realFetch = globalThis.fetch;
  const calls: { body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("generativelanguage.googleapis.com")) {
      return realFetch(input, init);
    }
    const body = JSON.parse(String(init?.body));
    // Gemini Embedding: a unit vector per input (test/search.test.ts covers it).
    if (url.includes(":batchEmbedContents")) {
      return Response.json({
        embeddings: body.requests.map(() => ({
          values: [1, ...new Array(EMBEDDING.dimensions - 1).fill(0)],
        })),
      });
    }
    calls.push({ body });
    const next = replies.shift() ?? 503;
    if (typeof next === "number") return new Response("", { status: next });
    return Response.json({
      candidates: [{ content: { parts: [{ text: next }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    });
  });
  return calls;
}

/** Real providers (stubbed), not the fake one. */
const withProviders = (ai: Bindings["AI"], over: Partial<Bindings> = {}) =>
  env({
    INDEXING_PROVIDER: undefined,
    AI: ai,
    GEMINI_API_KEY: "test-key",
    GEMINI_PAID_TIER: "true",
    ...over,
  });

async function capture(call: Call, body: string) {
  const res = await call("/api/memories", { method: "POST", json: { body } });
  expect(res.status).toBe(201);
  return (await res.json()) as Memory;
}
const read = async (call: Call, id: string) =>
  (await (await call(`/api/memories/${id}`)).json()) as Memory;
const search = async (call: Call, q: string) =>
  (
    (await (await call(`/api/search?q=${encodeURIComponent(q)}`)).json()) as {
      results: Memory[];
    }
  ).results.map((m) => m.id);
const sentFor = (id: string) =>
  [...queues.fresh.sent, ...queues.background.sent].filter(
    (m) => m.body.memoryId === id
  );

describe.skipIf(!databaseUrl)("Indexing", () => {
  it("indexes a text Capture with Gemma: Indexing, then Searchable and found by what it described", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Lemon tart with a short crust");
    expect(memory.indexState).toBe("indexing");
    expect(queues.fresh.sent.map((m) => m.body)).toContainEqual({
      memoryId: memory.id,
      run: 1,
      priority: "fresh",
    });
    // Its own words are searchable before Indexing finishes.
    expect(await search(call, "lemon")).toContain(memory.id);

    const ai = gemma(answer());
    const [message] = await drain(memory.id, withProviders(ai));
    expect(message!.ack).toHaveBeenCalled();
    expect(await read(call, memory.id)).toMatchObject({
      indexState: "searchable",
      indexError: null,
    });
    expect(await search(call, "zesty")).toContain(memory.id);

    const [model, input] = ai.run.mock.calls[0]!;
    expect(model).toBe(INDEXING.models["workers-ai"]);
    const [system, user] = input.messages as { content: string }[];
    expect(system!.content).not.toContain("Lemon");
    expect(user!.content).toContain("<text>\nLemon tart with a short crust");
  });

  it("falls back to Gemini (paid tier) when Gemma answers badly twice", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Fallback please");
    const ai = gemma("not json", answer({ tags: "x" }));
    const api = geminiApi(answer({ description: "Saffron buns" }));
    await drain(memory.id, withProviders(ai));
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(api).toHaveLength(1);
    expect(await search(call, "saffron")).toContain(memory.id);
  });

  it("overflows to Gemini when Gemma's daily allocation is used up", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Overflow please");
    const ai = gemma(new Error("3036: daily free allocation used up"));
    const api = geminiApi(answer());
    await drain(memory.id, withProviders(ai));
    expect(api).toHaveLength(1);
    expect((await read(call, memory.id)).indexState).toBe("searchable");
  });

  it("never sends to Gemini without the paid-tier flag", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Free tier never");
    const api = geminiApi(answer());
    const [message] = await drain(
      memory.id,
      withProviders(gemma(new Error("3040: capacity")), {
        GEMINI_PAID_TIER: undefined,
      })
    );
    expect(api).toHaveLength(0);
    expect(message!.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });

  it("retries with backoff while both providers fail, then Failed with a reason, and Retry indexes it", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Everything is down");
    const down = () => withProviders(gemma(new Error("5000: oops")));
    geminiApi(500, 500, 500);
    const body = { memoryId: memory.id, priority: "fresh" as const };
    const first = await deliver("spark-index-local", body, 1, down());
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect((await read(call, memory.id)).indexState).toBe("indexing");
    const last = await deliver(
      "spark-index-local",
      body,
      INDEXING.maxAttempts,
      down()
    );
    expect(last.ack).toHaveBeenCalled();
    expect(await read(call, memory.id)).toMatchObject({
      indexState: "failed",
      indexError: "unavailable",
    });

    queues.fresh.sent.length = 0;
    const retry = await call(`/api/memories/${memory.id}/reindex`, {
      method: "POST",
    });
    expect(((await retry.json()) as Memory).indexState).toBe("indexing");
    expect(sentFor(memory.id)).toHaveLength(1);
    await drain(memory.id, withProviders(gemma(answer())));
    expect((await read(call, memory.id)).indexState).toBe("searchable");
  });

  it("does the work once for a duplicate delivery", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Delivered twice");
    const ai = gemma(answer(), answer());
    const body = { memoryId: memory.id, priority: "fresh" as const };
    await deliver("spark-index-local", body, 1, withProviders(ai));
    const again = await deliver(
      "spark-index-local",
      body,
      1,
      withProviders(ai)
    );
    expect(again.ack).toHaveBeenCalled();
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("pays once when the same message is delivered twice at the same time", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Delivered twice at once");
    let answer_!: () => void;
    const slow = {
      run: vi.fn(async () => {
        await new Promise<void>((done) => (answer_ = done));
        return { choices: [{ message: { content: answer() } }] };
      }),
    };
    const body = { memoryId: memory.id, run: 1, priority: "fresh" as const };
    const first = deliver("spark-index-local", body, 1, withProviders(slow));
    await vi.waitFor(() => expect(slow.run).toHaveBeenCalled());
    const second = await deliver(
      "spark-index-local",
      body,
      1,
      withProviders(slow)
    );
    expect(second.ack).toHaveBeenCalled();
    answer_();
    await first;
    expect(slow.run).toHaveBeenCalledTimes(1);
    expect((await read(call, memory.id)).indexState).toBe("searchable");
  });

  it("ignores a dead letter from a run that has moved on", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Old dead letter");
    await call(`/api/memories/${memory.id}`, {
      method: "PATCH",
      json: { body: "Edited since" },
    });
    await deliver("spark-index-failed-local", {
      memoryId: memory.id,
      run: 1,
      priority: "fresh",
    });
    expect((await read(call, memory.id)).indexState).toBe("indexing");
  });

  it("re-indexes changed text in the background", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "First text");
    await drain(memory.id);
    queues.background.sent.length = 0;
    const res = await call(`/api/memories/${memory.id}`, {
      method: "PATCH",
      json: { body: "Second text" },
    });
    expect(((await res.json()) as Memory).indexState).toBe("indexing");
    expect(queues.background.sent.map((m) => m.body)).toContainEqual({
      memoryId: memory.id,
      run: 2,
      priority: "background",
    });
    await drain(memory.id);
    expect((await read(call, memory.id)).indexState).toBe("searchable");
    expect(await search(call, FAKE_WORD)).toContain(memory.id);
  });

  describe("AI opt-out", () => {
    it("never reaches a provider: not after Capture, not after an edit, not on Retry", async () => {
      const { call } = await signedIn();
      const memory = await capture(call, "My passport number");
      const opt = await call(`/api/memories/${memory.id}/ai-opt-out`, {
        method: "PUT",
        json: { aiOptOut: true },
      });
      expect(await opt.json()).toMatchObject({
        aiOptOut: true,
        indexState: "searchable",
      });
      const ai = gemma(answer(), answer());
      const api = geminiApi(answer());
      // The Capture's message arrives after the switch: nothing is sent.
      await drain(memory.id, withProviders(ai));
      await call(`/api/memories/${memory.id}`, {
        method: "PATCH",
        json: { body: "My passport number, renewed" },
      });
      await call(`/api/memories/${memory.id}/reindex`, { method: "POST" });
      expect(sentFor(memory.id)).toEqual([]);
      // Even a message that reaches the consumer anyway sends nothing.
      await deliver(
        "spark-index-local",
        { memoryId: memory.id, priority: "fresh" },
        1,
        withProviders(ai)
      );
      expect(ai.run).not.toHaveBeenCalled();
      expect(api).toEqual([]);
      expect(await read(call, memory.id)).toMatchObject({
        indexState: "searchable",
        aiOptOut: true,
      });
      expect(await search(call, "passport")).toContain(memory.id);
    });

    it("switched off, Indexes again", async () => {
      const { call } = await signedIn();
      const memory = await capture(call, "Opt in later");
      await call(`/api/memories/${memory.id}/ai-opt-out`, {
        method: "PUT",
        json: { aiOptOut: true },
      });
      await drain(memory.id);
      const res = await call(`/api/memories/${memory.id}/ai-opt-out`, {
        method: "PUT",
        json: { aiOptOut: false },
      });
      expect(((await res.json()) as Memory).indexState).toBe("indexing");
      await drain(memory.id);
      expect(await search(call, FAKE_WORD)).toContain(memory.id);
    });
  });

  it("sends an image's bytes to the model and names it", async () => {
    const { call } = await signedIn();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7]);
    const id = crypto.randomUUID();
    const created = await call("/api/memories/images", {
      method: "POST",
      json: {
        id,
        mime: "image/png",
        bytes: png.byteLength,
        width: 10,
        height: 10,
        contentHash: "cd".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 3 },
        palette: ["#ff8800", "#112233"],
      },
    });
    const { uploads } = (await created.json()) as {
      uploads: { role: string; url: string; headers: Record<string, string> }[];
    };
    expect(sentFor(id)).toEqual([]);
    for (const u of uploads) {
      const body = u.role === "original" ? png : new Uint8Array([1, 2, 3]);
      const headers = new Headers(u.headers);
      headers.set("content-length", String(body.byteLength));
      await worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(
          new URL(u.url, ORIGIN),
          { method: "PUT", headers, body }
        ),
        env(),
        ctx
      );
    }
    await call(`/api/memories/${id}/stored`, { method: "POST" });
    expect(sentFor(id)).toHaveLength(1);
    const ai = gemma(answer({ title: "Orange poster" }));
    await drain(id, withProviders(ai));
    const content = (
      ai.run.mock.calls[0]![1].messages as { content: unknown }[]
    )[1]!.content as { type: string; image_url?: { url: string } }[];
    expect(content[1]!.image_url!.url).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
    );
    expect(await read(call, id)).toMatchObject({
      indexState: "searchable",
      indexTitle: "Orange poster",
    });
  });

  it("marks a Memory Failed when the queue gives up on its message", async () => {
    const { call } = await signedIn();
    const memory = await capture(call, "Dead letter");
    const message = await deliver("spark-index-failed-local", {
      memoryId: memory.id,
      priority: "fresh",
    });
    expect(message.ack).toHaveBeenCalled();
    expect((await read(call, memory.id)).indexState).toBe("failed");
  });

  it("answers the dashboard's poll with just the Memories it asks about", async () => {
    const { call } = await signedIn();
    const a = await capture(call, "Poll a");
    await capture(call, "Poll b");
    const res = await call(`/api/memories?ids=${a.id},not-an-id`);
    expect(await res.json()).toMatchObject({
      memories: [{ id: a.id, indexState: "indexing" }],
    });
    const many = Array.from({ length: 101 }, () => crypto.randomUUID());
    expect((await call(`/api/memories?ids=${many.join(",")}`)).status).toBe(
      400
    );
  });
});
