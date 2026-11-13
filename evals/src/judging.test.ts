import { describe, expect, it } from "vitest";
import { JUDGING } from "@spark/core";
import {
  directScore,
  formatDirectScore,
  leaveOneOut,
  rejudge,
  tune,
} from "./judging";
import { delays, percentile } from "./latency";
import type { JudgedResult, SearchOutcome } from "./run";

const result = (r: Partial<JudgedResult> & { id: string }): JudgedResult => ({
  relevant: false,
  match: "related",
  matched: ["typo"],
  distance: null,
  score: 1,
  ...r,
});
const outcome = (id: string, judged: JudgedResult[]): SearchOutcome => ({
  id,
  kind: "x",
  rank: 1,
  top: [],
  matchedBy: [],
  fellBack: false,
  judged,
});

describe("directScore", () => {
  it("counts precision over Direct results, whether the right one is Direct, and searches with none", () => {
    const score = directScore([
      // The right Memory is Direct, beside a wrong one called Direct.
      outcome("a", [
        result({ id: "1", relevant: true, match: "direct" }),
        result({ id: "2", match: "direct" }),
      ]),
      // The right Memory is there but Related; nothing is Direct.
      outcome("b", [result({ id: "1", relevant: true })]),
      // Nothing right in the results at all.
      outcome("c", [result({ id: "1" })]),
    ]);
    expect(score).toEqual({
      searches: 3,
      direct: 2,
      directRight: 1,
      judged: 2,
      judgedDirect: 1,
      none: 2,
    });
    expect(formatDirectScore(score)).toBe(
      "Direct Matches  precision 1/2  50.0%  right one Direct 1/2  50.0%  none Direct 2/3"
    );
  });
});

describe("rejudge and tune", () => {
  // A clear winner two legs found, then a long tail: what the lead rule is for.
  const winner = outcome("w", [
    result({
      id: "1",
      relevant: true,
      matched: ["typo", "vector"],
      distance: 0.55,
      score: 1,
    }),
    result({ id: "2", score: 0.3 }),
  ]);
  // A far-off keyword hit: Direct only without the relative-score floor.
  const tail = outcome("t", [
    result({ id: "1", relevant: true, matched: ["keyword"], score: 1 }),
    result({ id: "2", matched: ["keyword"], score: 0.4 }),
  ]);

  it("rules the same results again with other thresholds", () => {
    const t = { ...JUDGING.thresholds };
    const direct = (o: SearchOutcome[]) =>
      o.flatMap((s) => s.judged.filter((r) => r.match === "direct")).length;
    expect(direct(rejudge([winner, tail], { ...t, leadRunnerUp: 0 }))).toBe(1);
    expect(direct(rejudge([winner, tail], t))).toBe(2);
    expect(
      direct(rejudge([winner, tail], { ...t, keywordMinRelative: 0 }))
    ).toBe(3);
  });

  it("puts the thresholds that call only right results Direct first, and keeps a frozen one", () => {
    const [best] = tune([winner, tail], { freeze: ["directDistance"] });
    expect(best!.score.direct).toBe(best!.score.directRight);
    expect(best!.score.judgedDirect).toBe(2);
    expect(best!.thresholds.directDistance).toBe(
      JUDGING.thresholds.directDistance
    );
  });
});

describe("leaveOneOut", () => {
  const winner = (id: string) =>
    outcome(id, [
      result({
        id: "1",
        relevant: true,
        matched: ["typo", "vector"],
        distance: 0.55,
        score: 1,
      }),
      result({ id: "2", score: 0.3 }),
    ]);

  it("rules on each search with values tuned on the others, and adds the scores up", () => {
    const searches = ["a", "b", "c", "d"].map(winner);
    const held = leaveOneOut(searches, { freeze: ["directDistance"] });
    // Four alike searches: what is learnt from three holds for the fourth.
    expect(held).toEqual({
      searches: 4,
      direct: 4,
      directRight: 4,
      judged: 4,
      judgedDirect: 4,
      none: 0,
    });
  });

  it("scores worse than tuning on the same searches when a search is unlike the rest", () => {
    // The odd search is a weaker keyword hit that no value learnt from the
    // others makes Direct, so held out it can only do as well as in sample.
    const odd = outcome("odd", [
      result({ id: "1", relevant: true, matched: ["keyword"], score: 0.5 }),
      result({ id: "2", score: 1 }),
    ]);
    const searches = [winner("a"), winner("b"), odd];
    const inSample = tune(searches, { freeze: ["directDistance"] })[0]!.score;
    const held = leaveOneOut(searches, { freeze: ["directDistance"] });
    expect(held.searches).toBe(3);
    expect(held.judgedDirect).toBeLessThanOrEqual(inSample.judgedDirect);
  });
});

describe("latency stand-ins", () => {
  it("takes percentiles by nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile([], 0.95)).toBe(0);
  });

  it("draws the same delays for the same seed, near the median and p95 asked for", () => {
    const next = delays({ medianMs: 300, p95Ms: 700 }, 7);
    const again = delays({ medianMs: 300, p95Ms: 700 }, 7);
    const drawn = Array.from({ length: 4000 }, next);
    expect(drawn.slice(0, 5)).toEqual(Array.from({ length: 5 }, again));
    expect(percentile(drawn, 0.5)).toBeGreaterThan(270);
    expect(percentile(drawn, 0.5)).toBeLessThan(330);
    expect(percentile(drawn, 0.95)).toBeGreaterThan(620);
    expect(percentile(drawn, 0.95)).toBeLessThan(780);
  });
});
