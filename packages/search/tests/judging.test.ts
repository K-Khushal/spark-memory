import { afterEach, describe, expect, it, vi } from "vitest";
import { INDEXING, JUDGING } from "@spark/core";
import type { AiCall, Embedder, JudgeClient } from "@spark/indexing";
import {
  createSearch,
  jevMatchJudge,
  thresholdJudge,
  type Candidate,
  type MatchJudge,
} from "../index";

type Said = {
  id: string;
  matched: string[];
  distance: number | null;
  score?: number;
};

const embedder: Embedder = {
  name: "gemini",
  model: "gemini-embedding-2",
  dimensions: 3,
  embed: async () => ({
    vectors: [[0, 1, 0]],
    usage: { textTokens: 10, imageTokens: 0 },
  }),
};

const budget = (spent = 0) => {
  const calls: AiCall[] = [];
  return {
    calls,
    spentTodayMicros: async () => spent,
    dailyBudgetMicros: async () => INDEXING.dailyBudgetMicros,
    recordCall: async (call: AiCall) => void calls.push(call),
  };
};

let user = 0;
const searchWith = (
  hits: Said[],
  judge?: MatchJudge,
  now: () => number = () => 0
) =>
  createSearch({
    userId: `judging-${++user}`,
    find: async () => hits.map((h) => ({ score: 1, ...h })),
    embedder,
    spend: budget(),
    ...(judge && { judge }),
    now,
  });

const close = (id: string): Said => ({
  id,
  matched: ["vector"],
  distance: 0.1,
});
const far = (id: string): Said => ({ id, matched: ["vector"], distance: 0.5 });
const matches = (answer: { results: { id: string; match: string }[] }) =>
  answer.results.map((r) => `${r.id}:${r.match}`);

afterEach(() => {
  vi.useRealTimers();
});

describe("the threshold judge", () => {
  const candidate = (c: Partial<Candidate>): Candidate => ({
    id: "a",
    matched: [],
    distance: null,
    score: 1,
    topScore: 1,
    rank: 5,
    nextScore: 1,
    ...c,
  });
  const ruled = async (c: Partial<Candidate>, thresholds?: never) =>
    (
      await thresholdJudge(thresholds).judge(
        "x",
        [candidate(c)],
        new AbortController().signal
      )
    ).get("a");

  it("rules Direct on words, a filter or a very close vector, Related otherwise", async () => {
    expect(await ruled({ matched: ["keyword"] })).toBe("direct");
    expect(await ruled({ matched: ["filter"] })).toBe("direct");
    expect(
      await ruled({
        matched: ["vector"],
        distance: JUDGING.thresholds.directDistance,
      })
    ).toBe("direct");
    expect(
      await ruled({
        matched: ["vector"],
        distance: JUDGING.thresholds.directDistance + 0.01,
      })
    ).toBe("related");
    expect(await ruled({ matched: ["typo"] })).toBe("related");
  });

  it("does not trust a keyword far behind the best result", async () => {
    const { keywordMinRelative } = JUDGING.thresholds;
    expect(
      await ruled({ matched: ["keyword"], score: keywordMinRelative })
    ).toBe("direct");
    expect(
      await ruled({ matched: ["keyword"], score: keywordMinRelative - 0.01 })
    ).toBe("related");
  });

  it("rules the clear winner Direct when two legs agree on it", async () => {
    const { leadRunnerUp } = JUDGING.thresholds;
    const winner = { matched: ["typo", "vector"], distance: 0.55, rank: 0 };
    expect(await ruled({ ...winner, nextScore: leadRunnerUp })).toBe("direct");
    expect(await ruled({ ...winner, nextScore: leadRunnerUp + 0.01 })).toBe(
      "related"
    );
    // One leg, or not the best result: never on this rule.
    expect(await ruled({ ...winner, matched: ["typo"], nextScore: 0 })).toBe(
      "related"
    );
    expect(await ruled({ ...winner, rank: 1, nextScore: 0 })).toBe("related");
  });
});

describe("Direct and Related Matches", () => {
  it("lets only the first results of a search with words be Direct", async () => {
    const hits = Array.from({ length: JUDGING.window + 5 }, (_, i) =>
      close(`m${i}`)
    );
    const { results } = await searchWith(hits).search("sunset", "full");
    expect(results.filter((r) => r.match === "direct")).toHaveLength(
      JUDGING.window
    );
    expect(results.at(-1)!.match).toBe("related");
  });

  it("counts a later page from where it begins", async () => {
    const hits = Array.from({ length: 6 }, (_, i) => close(`m${i}`));
    const { results } = await searchWith(hits).search("sunset", "instant", {
      page: `o:${JUDGING.window - 2}`,
    });
    expect(results.filter((r) => r.match === "direct")).toHaveLength(2);
  });

  it("asks the judge in full mode only, with the best results and the time left", async () => {
    const judge = vi.fn<MatchJudge["judge"]>(async () => new Map());
    const hits = Array.from({ length: JUDGING.window + 5 }, (_, i) =>
      close(`m${i}`)
    );
    const search = searchWith(hits, { judge });
    await search.search("sunset", "instant");
    expect(judge).not.toHaveBeenCalled();
    await search.search("sunset", "full");
    expect(judge).toHaveBeenCalledTimes(1);
    const [query, candidates] = judge.mock.calls[0]!;
    expect(query).toBe("sunset");
    expect(candidates).toHaveLength(JUDGING.window);
  });

  it("never asks the judge about a browse, which has no words", async () => {
    const judge = vi.fn<MatchJudge["judge"]>(async () => new Map());
    const search = searchWith(
      [{ id: "m", matched: ["filter"], distance: null }],
      {
        judge,
      }
    );
    const { results } = await search.search("", "full", {
      chips: { kind: "pdf" },
    });
    expect(judge).not.toHaveBeenCalled();
    expect(matches({ results })).toEqual(["m:direct"]);
  });

  it("lets the judge overrule thresholds for the Memories it ruled on, and only those", async () => {
    const judge: MatchJudge = {
      judge: async () =>
        new Map([
          ["a", "related"],
          ["b", "direct"],
        ]),
    };
    const answer = await searchWith(
      [close("a"), far("b"), close("c")],
      judge
    ).search("sunset", "full");
    expect(matches(answer)).toEqual(["a:related", "b:direct", "c:direct"]);
  });

  it("falls back to thresholds when the judge fails, silently", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const judge: MatchJudge = {
      judge: async () => {
        throw new Error("jev unavailable");
      },
    };
    const answer = await searchWith([close("a"), far("b")], judge).search(
      "sunset",
      "full"
    );
    expect(matches(answer)).toEqual(["a:direct", "b:related"]);
    expect(answer.mode).toBe("full");
    error.mockRestore();
  });

  it("gives a slow judge only its own deadline, aborts it, and keeps the thresholds", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted = false;
    const judge: MatchJudge = {
      judge: (_q, _c, signal) =>
        new Promise(() =>
          signal.addEventListener("abort", () => (aborted = true))
        ),
    };
    const pending = searchWith([close("a"), far("b")], judge).search(
      "sunset",
      "full"
    );
    await vi.advanceTimersByTimeAsync(JUDGING.jevTimeoutMs);
    expect(matches(await pending)).toEqual(["a:direct", "b:related"]);
    expect(aborted).toBe(true);
    error.mockRestore();
  });

  it("does not ask the judge once full search has used up its time", async () => {
    const judge = vi.fn<MatchJudge["judge"]>(async () => new Map());
    let clock = 0;
    const search = createSearch({
      userId: `judging-${++user}`,
      find: async () => {
        clock += JUDGING.fullBudgetMs - JUDGING.jevMinMs + 1;
        return [{ ...close("a"), score: 1 }];
      },
      embedder,
      spend: budget(),
      judge: { judge },
      now: () => clock,
    });
    const { results } = await search.search("sunset", "full");
    expect(judge).not.toHaveBeenCalled();
    expect(results[0]!.match).toBe("direct");
  });
});

describe("the Jev judge", () => {
  const candidates = (...ids: string[]): Candidate[] =>
    ids.map((id) => ({
      id,
      matched: ["vector"],
      distance: 0.4,
      score: 1,
      topScore: 1,
      rank: 0,
      nextScore: 1,
    }));
  const signal = () => new AbortController().signal;
  const texts = (known: Record<string, string>) =>
    vi.fn(async (ids: string[]) => {
      return new Map(
        ids.filter((id) => id in known).map((id) => [id, known[id]!])
      );
    });
  const client = (probabilities: number[], inputTokens = 1_000_000) => {
    const judge = vi.fn<JudgeClient["judge"]>(async () => ({
      probabilities,
      inputTokens,
    }));
    return { model: "jev-1.14.0", judge } satisfies JudgeClient;
  };

  it("rules Direct at or above its threshold, and bills the input tokens", async () => {
    const spend = budget();
    const jev = client([JUDGING.jevThreshold, JUDGING.jevThreshold - 0.01]);
    const verdicts = await jevMatchJudge({
      client: jev,
      describe: texts({ a: "A sunset", b: "A harbour" }),
      userId: "u",
      spend,
    }).judge("sunset", candidates("a", "b"), signal());
    expect([...verdicts]).toEqual([
      ["a", "direct"],
      ["b", "related"],
    ]);
    expect(jev.judge).toHaveBeenCalledWith(
      "sunset",
      ["A sunset", "A harbour"],
      expect.anything()
    );
    expect(spend.calls).toEqual([
      expect.objectContaining({
        provider: "jev",
        memoryId: null,
        costMicros: 42_000,
      }),
    ]);
  });

  it("sends only the Memories it may read: the others are left for the thresholds", async () => {
    const jev = client([0.9]);
    // `describe` leaves out AI opt-out Memories and Samples (the Library's judgingTexts).
    const verdicts = await jevMatchJudge({
      client: jev,
      describe: texts({ readable: "Read me" }),
      userId: "u",
      spend: budget(),
    }).judge("q", candidates("opted-out", "readable", "sample"), signal());
    expect(jev.judge.mock.calls[0]![1]).toEqual(["Read me"]);
    expect([...verdicts.keys()]).toEqual(["readable"]);
  });

  it("makes no call when nothing may be read or the daily budget is spent", async () => {
    const jev = client([0.9]);
    const none = jevMatchJudge({
      client: jev,
      describe: texts({}),
      userId: "u",
      spend: budget(),
    });
    expect((await none.judge("q", candidates("a"), signal())).size).toBe(0);
    const broke = jevMatchJudge({
      client: jev,
      describe: texts({ a: "x" }),
      userId: "u",
      spend: budget(INDEXING.dailyBudgetMicros),
    });
    expect((await broke.judge("q", candidates("a"), signal())).size).toBe(0);
    expect(jev.judge).not.toHaveBeenCalled();
  });

  it("records the most a failed call could have cost, and rejects", async () => {
    const spend = budget();
    const jev: JudgeClient = {
      model: "jev-1.14.0",
      judge: async () => {
        throw new Error("jev unavailable");
      },
    };
    await expect(
      jevMatchJudge({
        client: jev,
        describe: texts({ a: "x" }),
        userId: "u",
        spend,
      }).judge("q", candidates("a"), signal())
    ).rejects.toThrow("jev unavailable");
    expect(spend.calls).toEqual([
      expect.objectContaining({ provider: "jev", estimated: true }),
    ]);
  });
});
