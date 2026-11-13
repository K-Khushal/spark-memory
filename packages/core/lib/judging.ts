import { z } from "zod";

/**
 * Direct and Related Matches (ADR-0008, PLAN.md §6.4). Jev's Noul answers
 * "is this Memory what the person described?" for the best results; its
 * numbers cannot be tuned until a key exists (off by default), so the
 * thresholds below are what decides while Jev is off, or when it is slow.
 * `thresholds` are tuned on the search test set: `pnpm --filter
 * @spark/evals eval:tune` (fake providers) and `eval:tune --real`.
 */
export const JUDGING = {
  /**
   * Bump it whenever the thresholds or the Jev question change, so a
   * tuning run can be compared with an earlier one.
   */
  version: 1,
  /** Only this many of a first page's best results can be a Direct Match. */
  window: 20,
  /** Full search is meant to answer within this (PLAN.md §6.3). */
  fullBudgetMs: 600,
  /** Kept back from `fullBudgetMs` for the rest of the answer once Jev has had its say. */
  reserveMs: 50,
  /** Jev gets at most this long, and only the time full search has left. */
  jevTimeoutMs: 350,
  /** Less than this left of `fullBudgetMs` less `reserveMs`: do not ask Jev at all. */
  jevMinMs: 120,
  /** Candidates sent to Jev in one request, and how much of each. */
  jevCandidateChars: 700,
  /** Noul's probability that a Memory is what was described, at or above which it is Direct. */
  jevThreshold: 0.5,
  thresholds: {
    /**
     * A vector alone makes a Memory Direct within this cosine distance.
     * Only `eval:tune --real` can set it: the fake embedder's distances
     * carry no meaning, so it keeps the original guess.
     */
    directDistance: 0.35,
    /** Found by its words, a Memory is Direct only if it scores at least this share of the best. */
    keywordMinRelative: 0.6,
    /**
     * The best result is Direct when two legs found it and the runner-up
     * scores at most this share of it (0 turns the rule off).
     */
    leadRunnerUp: 0.6,
  },
} as const;

export type MatchThresholds = {
  directDistance: number;
  keywordMinRelative: number;
  leadRunnerUp: number;
};

/** How a result is judged. */
export type Verdict = "direct" | "related";

/** What a search leg tells about one result: all the thresholds look at. */
export type MatchSignals = {
  matched: readonly string[];
  /** Cosine distance of its closest vector; null when the vector leg did not find it. */
  distance: number | null;
  /** Fused rank score, the best score in the same search and the next result's. */
  score: number;
  topScore: number;
  /** 0 for the best result. */
  rank: number;
  /** The score of the result after this one; 0 when there is none. */
  nextScore: number;
};

/**
 * Direct when a filter found it, its words did (and it is not far behind
 * the best), a vector came very close, or it is a clear winner that two
 * legs agree on; Related otherwise. Pure: this is the fallback judge, and
 * the rule the evals tune.
 */
export function thresholdMatch(
  { matched, distance, score, topScore, rank, nextScore }: MatchSignals,
  t: MatchThresholds = JUDGING.thresholds
): Verdict {
  // Scores are sums of fractions: 1.5/2.5 (words and typos, against a best
  // that vectors also found) must count as 0.6, not 0.5999999999999999.
  const relative = topScore > 0 ? score / topScore + 1e-9 : 1;
  if (matched.includes("filter")) return "direct";
  if (matched.includes("keyword") && relative >= t.keywordMinRelative)
    return "direct";
  if (distance !== null && distance <= t.directDistance) return "direct";
  if (
    t.leadRunnerUp > 0 &&
    rank === 0 &&
    matched.length >= 2 &&
    nextScore <= t.leadRunnerUp * score
  )
    return "direct";
  return "related";
}

/**
 * The signals of each of `hits` (best first) as the thresholds read them;
 * `from` is the rank of the first, for a later page.
 */
export function signalsOf<
  H extends Pick<MatchSignals, "matched" | "distance" | "score">,
>(hits: readonly H[], from = 0): (H & MatchSignals)[] {
  const topScore = hits.reduce((best, hit) => Math.max(best, hit.score), 0);
  return hits.map((hit, i) => ({
    ...hit,
    topScore,
    rank: from + i,
    nextScore: hits[i + 1]?.score ?? 0,
  }));
}

/** Jev's answer to one Noul question per candidate, checked before any probability is trusted. */
export const JevNoulReply = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }),
});
