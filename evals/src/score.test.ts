import { describe, expect, it } from "vitest";
import type { SearchOutcome } from "./run";
import { compare, formatReport, score, toBaseline, worstOf } from "./score";

const outcome = (
  id: string,
  rank: number | null,
  kind = "colour"
): SearchOutcome => ({
  id,
  kind,
  rank,
  top: [],
  matchedBy: [],
  fellBack: false,
  judged: [],
});

describe("score", () => {
  it("counts a search in top 1 only at rank 1 and in top 5 up to rank 5", () => {
    const s = score([
      outcome("a", 1),
      outcome("b", 5),
      outcome("c", 6),
      outcome("d", null),
    ]);
    expect(s).toMatchObject({ total: 4, top1: 1, top5: 2 });
  });

  it("breaks the scores down by what made the search hard", () => {
    const s = score([
      outcome("a", 1, "typo"),
      outcome("b", null, "typo"),
      outcome("c", 3, "colour"),
    ]);
    expect(s.byKind).toEqual({
      typo: { total: 2, top1: 1, top5: 1 },
      colour: { total: 1, top1: 0, top5: 1 },
    });
  });

  it("scores an empty set as nothing, not NaN", () => {
    expect(score([])).toMatchObject({ total: 0, top1: 0, top5: 0 });
  });
});

describe("worstOf", () => {
  it("keeps each search's worst rank across runs, and not found beats any rank", () => {
    const worst = worstOf([
      [outcome("a", 1), outcome("b", 2), outcome("c", 4)],
      [outcome("a", 3), outcome("b", null), outcome("c", 2)],
    ]);
    expect(worst.map((o) => [o.id, o.rank])).toEqual([
      ["a", 3],
      ["b", null],
      ["c", 4],
    ]);
  });
});

describe("compare to the baseline", () => {
  const baseline = toBaseline([
    outcome("a", 1),
    outcome("b", 2),
    outcome("c", 9),
  ]);

  it("passes when nothing got worse", () => {
    const run = [outcome("a", 1), outcome("b", 1), outcome("c", 3)];
    expect(compare(run, baseline).ok).toBe(true);
  });

  it("fails when top 1 drops by more than the tolerance and names the search", () => {
    const run = [outcome("a", 2), outcome("b", 2), outcome("c", 9)];
    const result = compare(run, baseline);
    expect(result.ok).toBe(false);
    expect(result.lost).toEqual(["a"]);
    expect(result.messages.join("\n")).toMatch(/top-1/);
  });

  it("fails when top 5 drops", () => {
    const run = [outcome("a", 1), outcome("b", 7), outcome("c", 9)];
    expect(compare(run, baseline).ok).toBe(false);
  });

  it("allows a drop inside the tolerance", () => {
    const wide = { ...baseline, tolerance: 0.5 };
    const run = [outcome("a", 2), outcome("b", 2), outcome("c", 9)];
    expect(compare(run, wide).ok).toBe(true);
  });

  it("only gates searches the baseline knows, and says which are new", () => {
    const run = [
      outcome("a", 1),
      outcome("b", 2),
      outcome("c", 9),
      outcome("owner-1", null),
    ];
    const result = compare(run, baseline);
    expect(result.ok).toBe(true);
    expect(result.newSearches).toEqual(["owner-1"]);
  });

  it("fails a run whose full search fell back to keywords", () => {
    const run = [
      { ...outcome("a", 1), fellBack: true },
      outcome("b", 2),
      outcome("c", 9),
    ];
    expect(compare(run, baseline).ok).toBe(false);
  });
});

describe("gate holes", () => {
  const baseline = toBaseline([outcome("a", 1), outcome("b", 2)]);

  it("fails when a baseline search is missing from the run, and names it", () => {
    const result = compare([outcome("a", 1)], baseline);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["b"]);
    expect(result.messages.join("\n")).toMatch(/missing/);
  });

  it("fails an empty comparison, so no search can pass for lack of searches", () => {
    expect(compare([], baseline).ok).toBe(false);
    expect(compare([outcome("x", 1)], baseline).ok).toBe(false);
    expect(
      compare([], {
        tolerance: 0.02,
        directPrecision: 0,
        directPrecisionTolerance: 0.02,
        ranks: {},
      }).ok
    ).toBe(false);
  });

  it("still allows extra searches, reported as new", () => {
    const run = [outcome("a", 1), outcome("b", 2), outcome("o1", null)];
    expect(compare(run, baseline)).toMatchObject({
      ok: true,
      newSearches: ["o1"],
    });
  });
});

describe("formatReport", () => {
  it("prints the totals, each kind and every search with where it landed", () => {
    const text = formatReport({
      memories: 3,
      costMicros: 0,
      searches: [outcome("a", 1), outcome("b", null)],
    });
    expect(text).toContain("top-1  1/2");
    expect(text).toContain("top-5  1/2");
    expect(text).toMatch(/a\s+#1/);
    expect(text).toMatch(/b\s+not found/);
  });

  it("never prints what a search or a Memory says: ids, ranks and counts only", () => {
    const secret = "my private query about dentist";
    const text = formatReport({
      memories: 1,
      costMicros: 0,
      searches: [
        {
          ...outcome("owner-01", 2),
          query: secret,
          top: ["note-x"],
        } as SearchOutcome,
      ],
    });
    expect(text).not.toContain(secret);
    expect(JSON.stringify(Object.keys(outcome("a", 1)))).not.toContain("query");
  });
});

describe("Direct-match precision gate", () => {
  const run = ["a", "b", "c"].map((id) => ({
    ...outcome(id, 1),
    judged: [
      {
        id: "hit",
        relevant: true,
        match: "related" as const,
        matched: ["keyword" as const],
        distance: null,
        score: 1,
      },
    ],
  }));
  it("gates held-out precision even when current Direct labels disagree", () => {
    const baseline = toBaseline(run);
    const wrong = run.map((o) => ({
      ...o,
      judged: o.judged.map((r) => ({ ...r, relevant: false })),
    }));
    expect(compare(wrong, baseline).messages.join("\n")).toMatch(
      /Direct-match precision/
    );
  });
  it("allows a held-out precision drop within its own tolerance", () => {
    const baseline = {
      ...toBaseline(run),
      directPrecision: 1,
      directPrecisionTolerance: 1,
    };
    const wrong = run.map((o) => ({
      ...o,
      judged: o.judged.map((r) => ({ ...r, relevant: false })),
    }));
    expect(compare(wrong, baseline).ok).toBe(true);
  });
});
