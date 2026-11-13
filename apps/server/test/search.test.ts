import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { EMBEDDING } from "@spark/core";
import type * as Core from "@spark/core";
import { queryVectorsCached } from "@spark/search";
import * as Search from "@spark/search";
import * as Sentry from "@sentry/cloudflare";
import { ProviderError } from "@spark/indexing";
import { requeueStalled } from "../src/indexing";
import {
  newClient,
  databaseUrl,
  drain,
  env,
  fakeTurnstile,
  postSearch,
  queues,
  signedIn,
} from "./worker";

vi.mock("@sentry/cloudflare", { spy: true });

// Real Postgres and fake-provider policy assertions must not depend on the
// shared VM completing database cost writes inside the production 350ms SLA.
// Search's deadline/fallback behavior is covered with controlled clocks in
// @spark/search; keep the integration deadline generous without changing it.
vi.mock("@spark/core", async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return {
    ...actual,
    JUDGING: {
      ...actual.JUDGING,
      fullBudgetMs: 60_000,
      jevTimeoutMs: 30_000,
    },
  };
});

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
    (await (await postSearch(call, { q, ...(mode && { mode }) })).json()) as {
      results: Result[];
    }
  ).results;

describe.skipIf(!databaseUrl)("hybrid search", () => {
  const sql = new Client({ connectionString: databaseUrl });
  beforeAll(() => sql.connect());
  afterAll(() => sql.end());

  it("validates transient image bodies, keeps them out of storage, and scopes Library probes", async () => {
    const { call } = await signedIn();
    const other = (await signedIn()).call;
    const id = await capture(call, "A blue dashboard");
    const before = await (await call("/api/memories")).json();
    const image = { mime: "image/png", data: "iVBORw0KGgo=" };
    const response = await postSearch(call, {
      mode: "full",
      image,
      q: "dashboard",
      chips: { kind: "note" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      mode: "full",
      results: [{ id, match: "related" }],
    });
    expect(await (await call("/api/memories")).json()).toEqual(before);
    expect(
      await (await postSearch(other, { mode: "full", memory: id })).json()
    ).toMatchObject({ results: [] });
    for (const bad of [
      { ...image, mime: "image/svg+xml" },
      { ...image, data: "AAAA" },
    ])
      expect(
        (await postSearch(call, { mode: "full", image: bad })).status
      ).toBe(400);
    expect(
      (
        await postSearch(call, {
          mode: "full",
          image: { ...image, data: "A".repeat(1_420_001) },
        })
      ).status
    ).toBe(413);
  });

  it.each([
    { failure: new Error("image_search_budget"), status: 503 },
    { failure: new ProviderError("failed"), status: 503 },
    { failure: new Error("database failed"), status: 500 },
  ])(
    "reports image-search failure with status $status through the appropriate error path",
    async ({ failure, status }) => {
      const { call } = await signedIn();
      const reported = vi.mocked(Sentry.captureException);
      reported.mockClear();
      vi.spyOn(Search, "createSearch").mockReturnValueOnce({
        search: async () => {
          throw failure;
        },
        similar: async () => [],
      });
      const response = await postSearch(call, {
        mode: "full",
        memory: "00000000-0000-4000-8000-000000000001",
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        ok: false,
        error: status === 503 ? "image_search_unavailable" : "internal_error",
      });
      if (status === 500) expect(reported).toHaveBeenCalledWith(failure);
      else expect(reported).not.toHaveBeenCalled();
    }
  );

  it("records committed searches behind authentication and isolates their history", async () => {
    expect((await newClient()("/api/search/recent")).status).toBe(401);
    const { call } = await signedIn();
    const other = (await signedIn()).call;
    const id = await capture(call, "Animation reference");
    expect(
      (
        await call("/api/search/events", {
          method: "POST",
          json: {
            query: "animations",
            memoryId: id,
            position: 1,
            reformulation: true,
          },
        })
      ).status
    ).toBe(204);
    const recent = (await (await call("/api/search/recent")).json()) as {
      searches: { id: string; query: string }[];
    };
    expect(recent.searches.map((s) => s.query)).toEqual(["animations"]);
    expect(await (await other("/api/search/recent")).json()).toEqual({
      searches: [],
    });
    await other(`/api/search/recent/${recent.searches[0]!.id}`, {
      method: "DELETE",
    });
    expect(
      ((await (await call("/api/search/recent")).json()) as typeof recent)
        .searches
    ).toHaveLength(1);
    expect(
      (
        await call("/api/search/events", {
          method: "POST",
          json: { query: "animations", memoryId: id, position: 0 },
        })
      ).status
    ).toBe(400);
    await call("/api/search/recent", { method: "DELETE" });
    expect(await (await call("/api/search/recent")).json()).toEqual({
      searches: [],
    });
  });

  it("narrows by filter chips and by the words typed, and browses without words", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Quarterly budget");
    await sql.query(
      "update memory set source_url = 'https://www.instagram.com/p/x' where id = $1",
      [id]
    );
    const ids = async (body: Record<string, unknown>) =>
      (
        (await (
          await postSearch(call, { timezone: "UTC", ...body })
        ).json()) as { results: Result[] }
      ).results.map((r) => r.id);
    expect(await ids({ q: "budget", chips: { source: "instagram" } })).toEqual([
      id,
    ]);
    expect(await ids({ q: "budget", chips: { source: "youtube" } })).toEqual(
      []
    );
    expect(
      await ids({ q: "budget", chips: { kind: "note", when: "today" } })
    ).toEqual([id]);
    expect(await ids({ q: "budget", chips: { kind: "pdf" } })).toEqual([]);
    // The same, typed: filters are read out of the words.
    expect(await ids({ q: "budget from instagram" })).toEqual([id]);
    expect(await ids({ q: "budget from youtube" })).toEqual([]);
    expect(await ids({ q: "budget from last year" })).toEqual([]);
    // Browsing: chips alone list the Library, each result saying why.
    const browse = (await (
      await postSearch(call, { chips: { kind: "note" } })
    ).json()) as { mode: string; results: Result[] };
    expect(browse.mode).toBe("instant");
    expect(browse.results[0]).toMatchObject({
      id,
      match: "direct",
      part: { kind: "filter", field: "kind", value: "text" },
    });
    expect(await ids({})).toEqual([]);
  });

  it("takes a search only in a POST body, and refuses what it does not know", async () => {
    const { call } = await signedIn();
    // What was typed must never be in a URL: there is no GET.
    expect((await call("/api/search?q=budget")).status).toBe(404);
    for (const bad of [
      { q: "budget", chips: { kind: "bogus" } },
      { q: "budget", chips: { colour: "#fff" } },
      { q: "budget", chips: { source: "a b" } },
      { q: "budget", chips: { when: "never" } },
      { q: "budget", chips: { category: "recipe" } },
      { q: "budget", mode: "deep" },
      { q: "budget", page: "o:0" },
      { q: "budget", page: "40" },
      { q: "budget", offset: 40 },
      { q: "x".repeat(2001) },
    ])
      expect(
        (await postSearch(call, bad)).status,
        JSON.stringify(bad).slice(0, 60)
      ).toBe(400);
    // A body too large for any search.
    expect(
      (await postSearch(call, { q: "x", timezone: "y".repeat(1_420_001) }))
        .status
    ).toBe(413);
  });

  it("pages browsing by the last Memory and ranked words by count, with no repeats", async () => {
    const { call, address } = await signedIn();
    const { rows } = await sql.query(`select id from "user" where email = $1`, [
      address,
    ]);
    const owner = rows[0].id as string;
    await sql.query(
      `insert into memory (user_id, kind, title, body, captured_at)
       select $1, 'text', 'lantern ' || n, 'lantern', now() - (n || ' minutes')::interval
       from generate_series(1, 45) n`,
      [owner]
    );
    type Page = { results: Result[]; next?: string };
    const pages = async (body: Record<string, unknown>) => {
      const seen: string[] = [];
      const nexts: (string | undefined)[] = [];
      let page: string | undefined;
      for (let i = 0; i < 4; i++) {
        const res = (await (
          await postSearch(call, { ...body, ...(page && { page }) })
        ).json()) as Page;
        seen.push(...res.results.map((r) => r.id));
        nexts.push(res.next);
        page = res.next;
        if (!page) break;
      }
      return { seen, nexts };
    };
    const browse = await pages({ chips: { kind: "note" } });
    expect(browse.seen).toHaveLength(45);
    expect(new Set(browse.seen).size).toBe(45);
    expect(browse.nexts[0]).toMatch(/^c:[\da-f-]{36}$/);
    expect(browse.nexts[1]).toBeUndefined();
    const words = await pages({ q: "lantern" });
    expect(words.seen).toHaveLength(45);
    expect(new Set(words.seen).size).toBe(45);
    expect(words.nexts[0]).toBe("o:40");
  });

  it("refuses a click without its position, and a position without its Memory", async () => {
    const { call } = await signedIn();
    const id = await capture(call, "Anything");
    for (const json of [
      { query: "x", memoryId: id },
      { query: "x", position: 1 },
      { query: "x".repeat(301) },
      { query: "x", memoryId: "not-a-uuid", position: 1 },
    ])
      expect(
        (await call("/api/search/events", { method: "POST", json })).status
      ).toBe(400);
  });

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

  it("lets Jev rule on Direct Matches when it is on, never reads AI opt-out or Sample Memories, and records the cost", async () => {
    const { call, address } = await signedIn();
    const read = await capture(call, "Sunset over the dock");
    const optedOut = await capture(call, "Sunset over the dock");
    const sample = await capture(call, "Sunset over the dock");
    await call(`/api/memories/${optedOut}/ai-opt-out`, {
      method: "PUT",
      json: { aiOptOut: true },
    });
    await sql.query("update memory set sample = true where id = $1", [sample]);
    const sent: { state: { search: string; saved: Record<string, string> } }[] =
      [];
    const before = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("api.typesafe.ai")) return before(input, init);
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({
        answers: { m0: { type: "noul", noul: 0.1 } },
        usage: { input_tokens: 500, output_tokens: 0 },
      });
    });
    const on = env({ JEV_API_KEY: "k", JEV_ENABLED: "true" });
    const ask = async (bindings: ReturnType<typeof env>) =>
      (
        (await (
          await postSearch(call, { q: "sunset", mode: "full" }, bindings)
        ).json()) as { results: Result[] }
      ).results;
    const matches = (results: Result[]) =>
      Object.fromEntries(results.map((r) => [r.id, r.match]));

    // Off by default: the thresholds decide, and nothing goes to Jev.
    const thresholds = matches(await ask(env()));
    expect(thresholds[read]).toBe("direct");
    expect(sent).toEqual([]);

    // On: Jev rules on the one Memory it may read; the others keep the thresholds.
    expect(matches(await ask(on))).toEqual({
      ...thresholds,
      [read]: "related",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.state.search).toBe("sunset");
    expect(Object.values(sent[0]!.state.saved)).toEqual([
      expect.stringContaining("Sunset over the dock"),
    ]);
    const { rows } = await sql.query(
      `select provider, input_tokens, cost_micros from ai_call
       where user_id = (select id from "user" where email = $1) and provider = 'jev'`,
      [address]
    );
    expect(rows).toEqual([
      { provider: "jev", input_tokens: 500, cost_micros: "21" },
    ]);

    // Unavailable: the thresholds decide again, and the search still answers.
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes("api.typesafe.ai")
        ? new Response("overloaded", { status: 529 })
        : before(input, init);
    });
    expect(matches(await ask(on))[read]).toBe("direct");
  });

  it("never sends a Memory captured over the Free allowance to Jev: its Direct Match stays with the thresholds", async () => {
    const { call } = await signedIn();
    const read = await capture(call, "Sunset over the dock");
    const over = await capture(call, "Sunset over the dock");
    await sql.query("update memory set over_allowance = true where id = $1", [
      over,
    ]);
    const sent: { state: { saved: Record<string, string> } }[] = [];
    const before = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("api.typesafe.ai")) return before(input, init);
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({
        answers: { m0: { type: "noul", noul: 0.1 } },
        usage: { input_tokens: 500, output_tokens: 0 },
      });
    });
    const on = env({ JEV_API_KEY: "k", JEV_ENABLED: "true" });
    const results = (
      (await (
        await postSearch(call, { q: "sunset", mode: "full" }, on)
      ).json()) as { results: Result[] }
    ).results;
    // Jev ruled on the one Memory it may read, and only its content was sent.
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!.state.saved)).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain(over);
    expect(Object.fromEntries(results.map((r) => [r.id, r.match]))).toEqual({
      [read]: "related",
      [over]: "direct",
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
        body: {
          memoryId: id,
          generation: expect.stringMatching(/^[0-9a-f-]{36}$/),
          priority: "background",
          task: "embed",
        },
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
      const res = await postSearch(call, { q: "sunset", mode: "full" }, gemini);
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
    await postSearch(call, { q: "lighthouse", mode: "full" }, gemini);
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
      generation: expect.stringMatching(/^[0-9a-f-]{36}$/),
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
