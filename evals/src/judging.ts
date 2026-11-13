import {
  JUDGING,
  signalsOf,
  thresholdMatch,
  type MatchThresholds,
} from "@spark/core";
import type { JudgedResult, SearchOutcome } from "./run";

/**
 * How well the Direct / Related split does (ADR-0008, PLAN.md §6.4), over
 * the judged results (the first `JUDGING.window`) of every search:
 *
 * - **precision**: of the results called Direct, how many a person would
 *   accept (`expect` or `also`). Spark never implies a loose match is exact,
 *   so this is the number to protect.
 * - **recall**: of the searches whose right Memory is in the judged results,
 *   how many show it as Direct.
 * - **none**: searches with no Direct Match at all, which the UI says
 *   honestly ("No Direct Matches").
 */
export type DirectScore = {
  searches: number;
  /** Direct results, and how many of them are accepted. */
  direct: number;
  directRight: number;
  /** Searches whose right Memory is judged, and how many of those have it Direct. */
  judged: number;
  judgedDirect: number;
  /** Searches with no Direct Match. */
  none: number;
};

export function directScore(outcomes: SearchOutcome[]): DirectScore {
  const score: DirectScore = {
    searches: outcomes.length,
    direct: 0,
    directRight: 0,
    judged: 0,
    judgedDirect: 0,
    none: 0,
  };
  for (const { judged } of outcomes) {
    const direct = judged.filter((r) => r.match === "direct");
    score.direct += direct.length;
    score.directRight += direct.filter((r) => r.relevant).length;
    if (!direct.length) score.none++;
    if (judged.some((r) => r.relevant)) {
      score.judged++;
      if (direct.some((r) => r.relevant)) score.judgedDirect++;
    }
  }
  return score;
}

const pct = (n: number, of: number) =>
  of ? `${((100 * n) / of).toFixed(1)}%` : "n/a";

export const formatDirectScore = (s: DirectScore) =>
  `Direct Matches  precision ${s.directRight}/${s.direct}  ${pct(s.directRight, s.direct)}  right one Direct ${s.judgedDirect}/${s.judged}  ${pct(s.judgedDirect, s.judged)}  none Direct ${s.none}/${s.searches}`;

/** The same judged results, ruled on again by other thresholds. */
export function rejudge(
  outcomes: SearchOutcome[],
  thresholds: MatchThresholds
): SearchOutcome[] {
  return outcomes.map((outcome) => ({
    ...outcome,
    judged: signalsOf(outcome.judged).map((r): JudgedResult => ({
      ...r,
      match: thresholdMatch(r, thresholds),
    })),
  }));
}

/** Precision counts twice as much as recall: a loose match shown as exact is the worse mistake. */
export function fHalf({
  direct,
  directRight,
  judged,
  judgedDirect,
}: DirectScore) {
  const precision = direct ? directRight / direct : 0;
  const recall = judged ? judgedDirect / judged : 0;
  return precision + recall
    ? (1.25 * precision * recall) / (0.25 * precision + recall)
    : 0;
}

export const GRID = {
  directDistance: [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5],
  keywordMinRelative: [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  leadRunnerUp: [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
} as const;

export type Tuned = {
  thresholds: MatchThresholds;
  score: DirectScore;
  f: number;
};

/**
 * Every combination on the grid, best first by F0.5 (ties: fewer searches
 * with no Direct Match, then the values nearest the current ones, so a
 * flat stretch of the grid does not move a number for nothing).
 * `freeze` keeps a threshold at its current value: the fake embedder's
 * distances mean nothing, so only a real run may move `directDistance`.
 */
export function tune(
  outcomes: SearchOutcome[],
  { freeze = [] }: { freeze?: (keyof MatchThresholds)[] } = {}
): Tuned[] {
  const now = JUDGING.thresholds;
  const values = (key: keyof MatchThresholds): readonly number[] =>
    freeze.includes(key) ? [now[key]] : GRID[key];
  const tried: Tuned[] = [];
  for (const directDistance of values("directDistance"))
    for (const keywordMinRelative of values("keywordMinRelative"))
      for (const leadRunnerUp of values("leadRunnerUp")) {
        const thresholds = { directDistance, keywordMinRelative, leadRunnerUp };
        const score = directScore(rejudge(outcomes, thresholds));
        tried.push({ thresholds, score, f: fHalf(score) });
      }
  const away = ({ thresholds: t }: Tuned) =>
    Math.abs(t.directDistance - now.directDistance) +
    Math.abs(t.keywordMinRelative - now.keywordMinRelative) +
    Math.abs(t.leadRunnerUp - now.leadRunnerUp);
  return tried.sort(
    (a, b) => b.f - a.f || a.score.none - b.score.none || away(a) - away(b)
  );
}

export function formatTuning(outcomes: SearchOutcome[], real: boolean) {
  const ranked = tune(outcomes, { freeze: real ? [] : ["directDistance"] });
  const best = ranked[0]!;
  const current = directScore(outcomes);
  const show = (t: MatchThresholds) =>
    `directDistance ${t.directDistance}, keywordMinRelative ${t.keywordMinRelative}, leadRunnerUp ${t.leadRunnerUp}`;
  return [
    `Current   ${show(JUDGING.thresholds)}`,
    `          ${formatDirectScore(current)}`,
    `Best      ${show(best.thresholds)}`,
    `          ${formatDirectScore(best.score)}`,
    "",
    `Put these in JUDGING.thresholds (packages/core/lib/judging.ts) and bump JUDGING.version.`,
    real
      ? "All three came from real providers."
      : "Fake providers: directDistance was left alone, because the fake embedder's distances mean nothing. Run eval:tune --real for it.",
  ].join("\n");
}
