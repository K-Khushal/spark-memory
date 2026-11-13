import { describe, expect, it, vi } from "vitest";
import { EMBEDDING, INDEXING, JUDGING, SEARCH_PAGE_SIZE } from "@spark/core";
import { ProviderError, type AiCall, type Embedder } from "@spark/indexing";
import {
  createSearch,
  forgetQueryVectors,
  queryVectorsCached,
  searchesTracked,
  type Probe,
} from "../index";

type Hit = {
  id: string;
  matched: string[];
  distance: number | null;
  score: number;
};
/** What a test says of a result; the rank score defaults to a middling one. */
type Said = Omit<Hit, "score"> & { score?: number };

/** The Library's search as a stub: records each call, answers `hits`. */
function library(said: Said[] = []) {
  const hits = said.map((hit): Hit => ({ score: 1, ...hit }));
  const calls: { query: string; probe?: Probe }[] = [];
  const asked: Record<string, unknown>[] = [];
  const find = vi.fn(
    async (query: string, options: { probe?: Probe }): Promise<Hit[]> => {
      calls.push({ query, ...(options.probe && { probe: options.probe }) });
      asked.push(options);
      return hits;
    }
  );
  return { find, calls, asked };
}

function embedder(fail?: ProviderError): Embedder & {
  embed: ReturnType<typeof vi.fn<Embedder["embed"]>>;
} {
  return {
    name: "gemini",
    model: "gemini-embedding-2",
    dimensions: 3,
    embed: vi.fn(async () => {
      if (fail) throw fail;
      return {
        vectors: [[0, 1, 0]],
        usage: { textTokens: 10, imageTokens: 0 },
      };
    }),
  };
}

function spend(spent = 0) {
  const calls: AiCall[] = [];
  return {
    calls,
    spentTodayMicros: async (): Promise<number> => spent,
    dailyBudgetMicros: async () => INDEXING.dailyBudgetMicros,
    recordCall: async (call: AiCall): Promise<void> => {
      calls.push(call);
    },
  };
}

let user = 0;
/** A fresh person per test, so the query cache never leaks between tests. */
const setup = ({
  hits = [] as Said[],
  model = embedder() as ReturnType<typeof embedder> | null,
  spent = 0,
  now = (): number => 0,
} = {}) => {
  const lib = library(hits);
  const budget = spend(spent);
  const search = createSearch({
    userId: `u${++user}`,
    find: lib.find,
    ...(model && { embedder: model }),
    spend: budget,
    now,
  });
  return { search, lib, budget, model };
};

describe("search", () => {
  it("never calls the provider in instant mode", async () => {
    const { search, lib, model } = setup();
    await search.search("purple dashboard", "instant");
    expect(model!.embed).not.toHaveBeenCalled();
    expect(lib.calls).toEqual([{ query: "purple dashboard" }]);
  });

  it("embeds the query in full mode and records its cost against no Memory", async () => {
    const { search, lib, budget, model } = setup();
    await search.search("  purple   dashboard ", "full");
    expect(model!.embed).toHaveBeenCalledWith(
      [{ text: "task: search result | query: purple dashboard" }],
      { timeoutMs: EMBEDDING.queryTimeoutMs }
    );
    expect(lib.calls[0]!.probe).toEqual({
      model: "gemini-embedding-2",
      dimensions: 3,
      vector: [0, 1, 0],
    });
    expect(budget.calls).toEqual([
      expect.objectContaining({ memoryId: null, costMicros: 2 }),
    ]);
  });

  it("falls back to keyword search, silently, when the provider fails, times out or the budget is spent", async () => {
    for (const { model, spent } of [
      { model: embedder(new ProviderError("overflow")), spent: 0 },
      {
        model: embedder(
          new ProviderError("failed", { inputTokens: 9, outputTokens: 0 })
        ),
        spent: 0,
      },
      { model: embedder(), spent: INDEXING.dailyBudgetMicros },
      { model: null, spent: 0 },
    ]) {
      const { search, lib } = setup({ model, spent });
      await expect(search.search("purple", "full")).resolves.toEqual({
        results: [],
        mode: "instant",
      });
      expect(lib.calls).toEqual([{ query: "purple" }]);
    }
  });

  it("falls back to keyword search when anything in the vector leg fails", async () => {
    const failures: {
      label: string;
      tweak: (s: ReturnType<typeof setup>) => void;
    }[] = [
      {
        label: "the SQL with a vector",
        tweak: ({ lib }) =>
          lib.find.mockImplementation(async (query, options) => {
            if (options.probe) throw new Error("halfvec out of range");
            lib.calls.push({ query });
            return [];
          }),
      },
      {
        label: "an embedder that throws something unexpected",
        tweak: ({ model }) =>
          (model!.embed = vi.fn(async () => {
            throw new TypeError("bad reply");
          })),
      },
      {
        label: "reading the budget",
        tweak: ({ budget }) =>
          (budget.spentTodayMicros = async () => {
            throw new Error("database down");
          }),
      },
    ];
    for (const { label, tweak } of failures) {
      const s = setup();
      tweak(s);
      await expect(s.search.search("purple", "full"), label).resolves.toEqual({
        results: [],
        mode: "instant",
      });
      expect(s.lib.calls.at(-1), label).toEqual({ query: "purple" });
    }
  });

  it("keeps the query vector when recording its cost fails", async () => {
    const s = setup();
    s.budget.recordCall = async () => {
      throw new Error("database down");
    };
    const answer = await s.search.search("purple", "full");
    expect(answer.mode).toBe("full");
    expect(s.lib.calls[0]!.probe).toMatchObject({ vector: [0, 1, 0] });
    expect(s.model!.embed).toHaveBeenCalledTimes(1);
  });

  it("records what a timed-out query may cost", async () => {
    const { search, budget } = setup({
      model: embedder(
        new ProviderError("failed", { inputTokens: 5_000_000, outputTokens: 0 })
      ),
    });
    await search.search("purple", "full");
    expect(budget.calls).toEqual([
      expect.objectContaining({ estimated: true, costMicros: 1_000_000 }),
    ]);
  });

  it("reuses a person's recent query vector, until it expires", async () => {
    let now = 0;
    const { search, model } = setup({ now: () => now });
    await search.search("purple", "full");
    await search.search("purple", "full");
    expect(model!.embed).toHaveBeenCalledTimes(1);
    now = EMBEDDING.queryCacheMs + 1;
    await search.search("purple", "full");
    expect(model!.embed).toHaveBeenCalledTimes(2);
  });

  it("never shares a query vector between people", async () => {
    const shared = embedder();
    await setup({ model: shared }).search.search("purple", "full");
    await setup({ model: shared }).search.search("purple", "full");
    expect(shared.embed).toHaveBeenCalledTimes(2);
  });

  it("splits Direct Matches (a keyword, or a very close vector) from Related ones, keeping the order", async () => {
    const { search } = setup({
      hits: [
        {
          id: "a",
          matched: ["vector"],
          distance: JUDGING.thresholds.directDistance,
        },
        { id: "b", matched: ["typo"], distance: null },
        { id: "c", matched: ["keyword", "vector"], distance: 0.5 },
        { id: "d", matched: ["vector"], distance: 0.5 },
      ],
    });
    const { results, mode } = await search.search("x", "full");
    expect(mode).toBe("full");
    expect(results.map((r) => [r.id, r.match])).toEqual([
      ["a", "direct"],
      ["b", "related"],
      ["c", "direct"],
      ["d", "related"],
    ]);
  });

  it("finds More Like This with the Memory's own vectors and no provider call", async () => {
    const { search, lib, model } = setup();
    await search.similar("m1");
    expect(model!.embed).not.toHaveBeenCalled();
    expect(lib.calls).toEqual([
      {
        query: "",
        probe: { model: "gemini-embedding-2", dimensions: 3, like: "m1" },
      },
    ]);
    expect(await setup({ model: null }).search.similar("m1")).toEqual([]);
  });

  it("forgets one person's query vectors, and only theirs, when their account goes", async () => {
    const shared = embedder();
    const ana = createSearch({
      userId: "forget-ana",
      find: library().find,
      embedder: shared,
      spend: spend(),
    });
    const ben = createSearch({
      userId: "forget-ben",
      find: library().find,
      embedder: shared,
      spend: spend(),
    });
    await ana.search("purple", "full");
    await ana.search("teal", "full");
    await ben.search("purple", "full");
    expect(queryVectorsCached("forget-ana")).toBe(2);
    forgetQueryVectors("forget-ana");
    expect(queryVectorsCached("forget-ana")).toBe(0);
    expect(queryVectorsCached("forget-ben")).toBe(1);
    // Ana's next search asks the provider again; Ben's still comes from the cache.
    await ana.search("purple", "full");
    await ben.search("purple", "full");
    expect(shared.embed).toHaveBeenCalledTimes(4);
  });

  it("never caches a query vector that arrives after the person's vectors were forgotten", async () => {
    let finish!: () => void;
    const slow = embedder();
    slow.embed = vi.fn(
      () =>
        new Promise<{
          vectors: number[][];
          usage: { textTokens: number; imageTokens: number };
        }>(
          (resolve) =>
            (finish = () =>
              resolve({
                vectors: [[0, 1, 0]],
                usage: { textTokens: 1, imageTokens: 0 },
              }))
        )
    );
    const search = createSearch({
      userId: "race-ana",
      find: library().find,
      embedder: slow,
      spend: spend(),
    });
    const pending = search.search("purple", "full");
    await vi.waitFor(() => expect(slow.embed).toHaveBeenCalled());
    forgetQueryVectors("race-ana");
    finish();
    await pending;
    expect(queryVectorsCached("race-ana")).toBe(0);
  });

  it("tracks only people with a search in flight, however many are forgotten", async () => {
    for (let i = 0; i < 1000; i++) forgetQueryVectors(`gone-${i}`);
    expect(searchesTracked()).toBe(0);
    let finish!: () => void;
    const slow = embedder();
    slow.embed = vi.fn(
      () =>
        new Promise<{
          vectors: number[][];
          usage: { textTokens: number; imageTokens: number };
        }>(
          (resolve) =>
            (finish = () =>
              resolve({
                vectors: [[0, 1, 0]],
                usage: { textTokens: 1, imageTokens: 0 },
              }))
        )
    );
    const pending = createSearch({
      userId: "tracked-ana",
      find: library().find,
      embedder: slow,
      spend: spend(),
    }).search("purple", "full");
    await vi.waitFor(() => expect(slow.embed).toHaveBeenCalled());
    expect(searchesTracked()).toBe(1);
    finish();
    await pending;
    expect(searchesTracked()).toBe(0);
    expect(queryVectorsCached("tracked-ana")).toBe(1);
  });

  describe("understanding the query", () => {
    const NOW = Date.UTC(2026, 10, 12, 12);

    it("searches the words that are left, narrowed by what it understood", async () => {
      const { search, lib, model } = setup({ now: () => NOW });
      await search.search("pdfs from instagram last month", "full", {
        timezone: "UTC",
      });
      expect(lib.calls[0]!.query).toBe("");
      expect(lib.asked[0]).toMatchObject({
        kinds: ["pdf"],
        filters: {
          hosts: ["instagram.com"],
          after: "2026-10-01T00:00:00.000Z",
          before: "2026-11-01T00:00:00.000Z",
        },
      });
      // Nothing to look for by meaning: no provider call, no cost.
      expect(model!.embed).not.toHaveBeenCalled();
    });

    it("embeds only the words, not the filters", async () => {
      const { search, model } = setup({ now: () => NOW });
      await search.search("videos from youtube about tardigrades", "full");
      expect(model!.embed).toHaveBeenCalledWith(
        [{ text: "task: search result | query: about tardigrades" }],
        { timeoutMs: EMBEDDING.queryTimeoutMs }
      );
    });

    it("gives a colour in the words as a preference, and a colour chip as a requirement", async () => {
      const { search, lib } = setup({ now: () => NOW });
      await search.search("orange animations", "instant");
      await search.search("animations", "instant", {
        chips: { colour: "blue" },
      });
      expect(lib.asked[0]!.filters).toEqual({ prefer: "#EE7A1C" });
      expect(lib.asked[1]!.filters).toEqual({ colour: "#2F6FE0" });
    });

    it("requires a colour when the words are nothing but filters", async () => {
      const { search, lib } = setup({ now: () => NOW });
      await search.search("orange pdfs from last month", "instant");
      expect(lib.asked[0]).toMatchObject({
        kinds: ["pdf"],
        filters: { colour: "#EE7A1C" },
      });
    });

    it("lets a chip override the same filter in the words", async () => {
      const { search, lib } = setup({ now: () => NOW });
      await search.search("links from reddit last week", "instant", {
        chips: { kind: "image", source: "youtube", when: "this year" },
      });
      expect(lib.asked[0]).toMatchObject({
        kinds: ["image"],
        filters: {
          hosts: ["youtube.com", "youtu.be"],
          after: "2026-01-01T00:00:00.000Z",
          before: "2027-01-01T00:00:00.000Z",
        },
      });
    });

    it("browses with chips alone, and returns nothing for no words and no chips", async () => {
      const { search, lib } = setup({ now: () => NOW });
      expect(await search.search("  ", "full")).toEqual({
        results: [],
        mode: "instant",
      });
      expect(lib.find).not.toHaveBeenCalled();
      await search.search("", "full", {
        chips: { colour: "orange" },
        page: "o:40",
      });
      expect(lib.asked[0]).toMatchObject({
        filters: { colour: "#EE7A1C" },
        offset: 40,
      });
    });

    it("passes a Category chip to the Library as one more filter, and browses by it alone", async () => {
      const { search, lib } = setup({ now: () => NOW });
      await search.search("", "instant", { chips: { category: "Recipe" } });
      expect(lib.asked[0]).toMatchObject({
        filters: { categories: ["Recipe"] },
      });
      await search.search("tart", "instant", {
        chips: { category: "Recipe", kind: "image" },
      });
      expect(lib.asked[1]).toMatchObject({
        kinds: ["image"],
        filters: { categories: ["Recipe"] },
      });
    });

    it("calls a result found by filters a Direct match", async () => {
      const { search } = setup({
        hits: [{ id: "a", matched: ["filter"], distance: null }],
      });
      const { results } = await search.search("", "instant", {
        chips: { source: "instagram" },
      });
      expect(results[0]).toMatchObject({ id: "a", match: "direct" });
    });

    it("keeps a colour word that is the whole query as a word too", async () => {
      const { search, lib } = setup({ now: () => NOW });
      await search.search("orange", "instant");
      expect(lib.calls[0]!.query).toBe("orange");
      expect(lib.asked[0]!.filters).toEqual({ prefer: "#EE7A1C" });
    });
  });

  describe("pages", () => {
    const hits = (n: number): Said[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        matched: ["filter"],
        distance: null,
      }));
    const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

    it("asks for one page, and says where the next begins", async () => {
      const { search, lib } = setup({ hits: hits(SEARCH_PAGE_SIZE) });
      // Newest first with no colour: after the last Memory shown.
      const browse = await search.search("", "instant", {
        chips: { kind: "image" },
      });
      expect(browse.next).toBe(`c:m${SEARCH_PAGE_SIZE - 1}`);
      expect(lib.asked[0]).toMatchObject({ limit: SEARCH_PAGE_SIZE });
      expect(lib.asked[0]).not.toHaveProperty("cursor");
      // Ranked by a score (words, or colour): by how many came before.
      expect((await search.search("budget", "instant")).next).toBe(
        `o:${SEARCH_PAGE_SIZE}`
      );
      expect(
        (await search.search("", "instant", { chips: { colour: "blue" } })).next
      ).toBe(`o:${SEARCH_PAGE_SIZE}`);
    });

    it("has no next page after a short one", async () => {
      const { search } = setup({ hits: hits(SEARCH_PAGE_SIZE - 1) });
      expect(
        await search.search("", "instant", { chips: { kind: "image" } })
      ).not.toHaveProperty("next");
    });

    it("continues from the page it is given", async () => {
      const { search, lib } = setup({ hits: hits(3) });
      await search.search("", "instant", {
        chips: { kind: "image" },
        page: `c:${ID}`,
      });
      await search.search("budget", "instant", { page: "o:80" });
      expect(lib.asked[0]).toMatchObject({ cursor: ID });
      expect(lib.asked[1]).toMatchObject({ offset: 80 });
      expect(lib.asked[1]).not.toHaveProperty("cursor");
    });

    it("ignores a cursor where there is nothing to browse", async () => {
      const { search, lib } = setup({ hits: hits(3) });
      await search.search("budget", "instant", { page: `c:${ID}` });
      expect(lib.asked[0]).not.toHaveProperty("cursor");
    });
  });
});

it("searches a transient image with words and filters, accounting image tokens", async () => {
  const { search, lib, budget, model } = setup();
  model!.embed.mockResolvedValue({
    vectors: [[0, 1, 0]],
    usage: { textTokens: 2, imageTokens: 258 },
  });
  const image = { mime: "image/png", data: "iVBORw0KGgo=" };
  await search.search("dashboard", "full", { image, chips: { kind: "image" } });
  expect(model!.embed.mock.calls[0]![0][0]).toEqual({
    image: {
      mime: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  });
  expect(lib.calls[0]!.probe).toEqual({
    model: "gemini-embedding-2",
    dimensions: 3,
    vector: [0, 1, 0],
    imageQuery: true,
  });
  expect(lib.calls[0]!.query).toBe("dashboard");
  expect(budget.calls[0]!.usage.inputTokens).toBe(260);
});

it("shares an in-flight image embedding and caches only its vector per owner", async () => {
  const { search, model, budget } = setup();
  const image = { mime: "image/png", data: "iVBORw0KGgo=" };
  await Promise.all([
    search.search("", "full", { image }),
    search.search("blue", "full", { image }),
  ]);
  expect(model!.embed).toHaveBeenCalledTimes(1);
  expect(budget.calls).toHaveLength(1);
  await search.search("red", "full", { image });
  expect(model!.embed).toHaveBeenCalledTimes(1);
});

it("image queries refuse exhausted budgets and missing providers, without a text fallback", async () => {
  const image = { mime: "image/png", data: "iVBORw0KGgo=" };
  for (const s of [
    setup({ spent: INDEXING.dailyBudgetMicros }),
    setup({ model: null }),
  ]) {
    await expect(s.search.search("blue", "full", { image })).rejects.toThrow();
    expect(s.lib.calls).toEqual([]);
  }
});

it("image Direct Matches require vector confidence even when keywords match", async () => {
  const { search } = setup({
    hits: [
      { id: "keyword", matched: ["keyword"], distance: 0.5, score: 0.02 },
      { id: "visual", matched: ["vector"], distance: 0.01, score: 0.01 },
    ],
  });
  const { results } = await search.search("blue", "full", {
    image: { mime: "image/png", data: "iVBORw0KGgo=" },
  });
  expect(results.map((r) => r.match)).toEqual(["related", "direct"]);
});

it("image queries use the threshold MatchJudge window and never send a text-only question to Jev", async () => {
  const lib = library(
    Array.from({ length: 21 }, (_, i) => ({
      id: String(i),
      matched: ["vector"],
      distance: 0.01,
      score: 1 / (i + 1),
    }))
  );
  const judge = { judge: vi.fn(async () => new Map()) };
  const search = createSearch({
    userId: `u${++user}`,
    find: lib.find,
    embedder: embedder(),
    spend: spend(),
    judge,
  });
  const { results } = await search.search("blue", "full", {
    image: { mime: "image/png", data: "iVBORw0KGgo=" },
  });
  expect(judge.judge).not.toHaveBeenCalled();
  expect(results.filter((r) => r.match === "direct")).toHaveLength(20);
  expect(results[20]!.match).toBe("related");
});
