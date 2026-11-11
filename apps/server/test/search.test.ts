import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { EMBEDDING } from "@spark/core";
import { queryVectorsCached } from "@spark/search";
import { requeueStalled } from "../src/indexing";
import {
  databaseUrl,
  drain,
  env,
  fakeTurnstile,
  queues,
  signedIn,
} from "./worker";

// Hybrid search through the Worker, with the fake provider and embedder
// (INDEXING_PROVIDER=fake): words the fake embedder reads as one meaning
// (FAKE_MEANINGS) find a Memory that contains none of the query's words.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Result = {
  id: string;
  match: "direct" | "related";
  part: { kind: string; field?: string; start?: number; end?: number };
};

async function capture(call: Call, body: string) {
  const res = await call("/api/memories", { method: "POST", json: { body } });
  const { id } = (await res.json()) as { id: string };
  await drain(id);
  return id;
}
const search = async (call: Call, q: string, mode?: "full") =>
  (
    (await (
      await call(
        `/api/search?q=${encodeURIComponent(q)}${mode ? `&mode=${mode}` : ""}`
      )
    ).json()) as { results: Result[] }
  ).results;

describe.skipIf(!databaseUrl)("hybrid search", () => {
  const sql = new Client({ connectionString: databaseUrl });
  beforeAll(() => sql.connect());
  afterAll(() => sql.end());

  it("finds a Memory by meaning in full mode, with the part that matched; instant mode by words only", async () => {
    const { call } = await signedIn();
    const sunset = await capture(call, "Sunset over the dock");
    await capture(call, "Grocery list: eggs and milk");

    expect(await search(call, "twilight harbor")).toEqual([]);
    const [top, ...rest] = await search(call, "twilight harbor", "full");
    expect(top).toMatchObject({
      id: sunset,
      match: "direct",
      part: { kind: "overview" },
    });
    expect(rest).toEqual([]);
    // A keyword hit says which field it matched in.
    expect((await search(call, "sunset"))[0]).toMatchObject({
      id: sunset,
      match: "direct",
      part: { kind: "field", field: "title" },
    });
  });

  it("says a Memory has vectors only where this environment can search with them", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Sunset over the dock");
    const hasVectors = async (bindings = env()) =>
      (
        (await (await call(`/api/memories/${id}`, {}, bindings)).json()) as {
          hasVectors: boolean;
        }
      ).hasVectors;
    expect(await hasVectors()).toBe(true);
    // Without the paid tier there is no embedder: More Like This has nothing.
    expect(await hasVectors(env({ INDEXING_PROVIDER: undefined }))).toBe(false);
  });

  it("finds More Like This from a Memory's own vectors, never another person's", async () => {
    const { call } = await signedIn();
    const dock = await capture(call, "Sunset over the dock");
    const harbour = await capture(call, "Dusk at the harbor");
    await capture(call, "Tax return checklist");
    const res = await call(`/api/memories/${dock}/similar`);
    const { results } = (await res.json()) as { results: Result[] };
    expect(results.map((r) => r.id)).toEqual([harbour]);

    const other = await signedIn();
    expect((await other.call(`/api/memories/${dock}/similar`)).status).toBe(
      404
    );
  });

  it("never embeds a Memory with AI opt-out: found by its words, not by meaning", async () => {
    const { call } = await signedIn();
    const res = await call("/api/memories", {
      method: "POST",
      json: { body: "Sunset over the dock" },
    });
    const { id } = (await res.json()) as { id: string };
    await call(`/api/memories/${id}/ai-opt-out`, {
      method: "PUT",
      json: { aiOptOut: true },
    });
    await drain(id);
    expect((await search(call, "twilight harbor", "full")).length).toBe(0);
    expect((await search(call, "sunset", "full"))[0]?.id).toBe(id);
    const vectors = await sql.query(
      "select 1 from memory_vector where memory_id = $1",
      [id]
    );
    expect(vectors.rowCount).toBe(0);
  });

  it("embeds again once an edited title settles", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Notes from the trip");
    queues.background.sent.length = 0;
    await call(`/api/memories/${id}`, {
      method: "PATCH",
      json: { title: "Sunset over the dock" },
    });
    expect(queues.background.sent).toEqual([
      {
        body: { memoryId: id, priority: "background", task: "embed" },
        delaySeconds: EMBEDDING.editDelaySeconds,
      },
    ]);
    expect((await search(call, "twilight", "full")).map((r) => r.id)).toEqual(
      []
    );
    const [message] = await drain(id);
    expect(message!.ack).toHaveBeenCalled();
    expect((await search(call, "twilight", "full"))[0]?.id).toBe(id);
  });

  it("falls back to keyword search when the embedding provider is down or answers nonsense", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Sunset over the dock");
    const gemini = env({
      INDEXING_PROVIDER: undefined,
      GEMINI_API_KEY: "test-key",
      GEMINI_PAID_TIER: "true",
    });
    const realFetch = globalThis.fetch;
    const values = new Array(EMBEDDING.dimensions).fill(0);
    let reply = () => new Response("", { status: 503 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input instanceof Request ? input.url : input).includes(
        "generativelanguage.googleapis.com"
      )
        ? reply()
        : realFetch(input, init)
    );
    for (const next of [
      () => new Response("", { status: 503 }),
      () => new Response('{"embeddings": [{"values": [0.1, 0', { status: 200 }),
      () =>
        Response.json({ embeddings: [{ values: [null, ...values.slice(1)] }] }),
      () =>
        Response.json({ embeddings: [{ values: [1e9, ...values.slice(1)] }] }),
    ]) {
      reply = next;
      // A failed embedding is never cached: each search asks again.
      const res = await call(`/api/search?q=sunset&mode=full`, {}, gemini);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Result[]; mode: string };
      expect(body.mode).toBe("instant");
      expect(body.results.map((r) => r.id)).toEqual([id]);
    }
  });

  it("forgets a person's cached query vectors when they delete their account", async () => {
    const { call, address } = await signedIn();
    const { id: userId } = (await (await call("/api/me")).json()) as {
      id: string;
    };
    const values = [1, ...new Array(EMBEDDING.dimensions - 1).fill(0)];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input instanceof Request ? input.url : input).includes(
        "generativelanguage.googleapis.com"
      )
        ? Response.json({ embeddings: [{ values }] })
        : realFetch(input, init)
    );
    const gemini = env({
      INDEXING_PROVIDER: undefined,
      GEMINI_API_KEY: "test-key",
      GEMINI_PAID_TIER: "true",
    });
    await call(`/api/search?q=lighthouse&mode=full`, {}, gemini);
    expect(queryVectorsCached(userId)).toBe(1);
    const res = await call(
      "/api/account",
      { method: "DELETE", json: { email: address } },
      gemini
    );
    expect(res.status).toBe(204);
    expect(queryVectorsCached(userId)).toBe(0);
  });

  it("re-embeds, hourly, Memories whose vectors are missing or stale", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Sunset over the dock");
    await sql.query(
      `update memory set vectors_space = 'old-model@768', updated_at = now() - interval '10 years' where id = $1`,
      [id]
    );
    queues.background.sent.length = 0;
    await requeueStalled(env());
    expect(queues.background.sent.map((m) => m.body)).toContainEqual({
      memoryId: id,
      priority: "background",
      task: "embed",
    });
    await drain(id);
    const { rows } = await sql.query(
      "select vectors_space from memory where id = $1",
      [id]
    );
    expect(rows[0].vectors_space).toBe("fake-embedding@768");
  });
});
