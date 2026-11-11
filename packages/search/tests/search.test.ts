import { describe, expect, it, vi } from "vitest";
import { EMBEDDING, INDEXING } from "@spark/core";
import { ProviderError, type AiCall, type Embedder } from "@spark/indexing";
import { createSearch, type Probe } from "../index";

type Hit = { id: string; matched: string[]; distance: number | null };

/** The Library's search as a stub: records each call, answers `hits`. */
function library(hits: Hit[] = []) {
  const calls: { query: string; probe?: Probe }[] = [];
  const find = vi.fn(async (query: string, options: { probe?: Probe }) => {
    calls.push({ query, ...(options.probe && { probe: options.probe }) });
    return hits;
  });
  return { find, calls };
}

function embedder(fail?: ProviderError) {
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
  } satisfies Embedder;
}

function spend(spent = 0) {
  const calls: AiCall[] = [];
  return {
    calls,
    spentTodayMicros: async () => spent,
    dailyBudgetMicros: async () => INDEXING.dailyBudgetMicros,
    recordCall: async (call: AiCall) => {
      calls.push(call);
    },
  };
}

let user = 0;
/** A fresh person per test, so the query cache never leaks between tests. */
const setup = ({
  hits = [] as Hit[],
  model = embedder() as Embedder | null,
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
        { id: "a", matched: ["vector"], distance: EMBEDDING.directDistance },
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
});
