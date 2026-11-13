import {
  JUDGING,
  thresholdMatch,
  type MatchSignals,
  type MatchThresholds,
} from "@spark/core";
import {
  jevCostMicros,
  jevTokenEstimate,
  type AiCall,
  type JudgeClient,
} from "@spark/indexing";

export type Verdict = "direct" | "related";

/** A result as a judge sees it: its id and what the search legs said of it. */
export type Candidate = MatchSignals & { id: string };

/**
 * Decides which of a search's best results are Direct Matches (ADR-0008).
 * Two implementations: `thresholdJudge` (the signals, tuned on the search
 * test set) and `jevMatchJudge` (Jev Noul, off until the owner enables it).
 */
export interface MatchJudge {
  /**
   * A verdict per candidate it could judge; one it may not or cannot judge
   * is left out, and the caller rules on it by thresholds. Rejects when it
   * cannot answer in time (`signal` aborts) or at all.
   */
  judge(
    query: string,
    candidates: readonly Candidate[],
    signal: AbortSignal
  ): Promise<Map<string, Verdict>>;
}

/** The signals alone: instant, free, and what decides while Jev is off. */
export function thresholdJudge(thresholds?: MatchThresholds): MatchJudge {
  return {
    async judge(_query, candidates) {
      return new Map(
        candidates.map((c) => [c.id, thresholdMatch(c, thresholds)])
      );
    },
  };
}

/**
 * Jev's Noul answers "is this what they described?" for the candidates it
 * may read. `describe` returns the text of the Memories it may send and
 * leaves out the rest (AI opt-out, Samples: ADR-0011), so those never reach
 * Jev and fall to the thresholds. The daily budget is checked first and
 * the call's cost is recorded, whether or not the answer arrives.
 */
export function jevMatchJudge({
  client,
  describe,
  userId,
  spend,
}: {
  client: JudgeClient;
  describe: (ids: string[], chars: number) => Promise<Map<string, string>>;
  userId: string;
  spend: {
    spentTodayMicros(): Promise<number>;
    dailyBudgetMicros(): Promise<number>;
    recordCall(call: AiCall): Promise<void>;
  };
}): MatchJudge {
  const record = (inputTokens: number, estimated?: boolean) =>
    spend
      .recordCall({
        userId,
        memoryId: null,
        provider: "jev",
        model: client.model,
        usage: { inputTokens, outputTokens: 0 },
        costMicros: jevCostMicros(client.model, inputTokens),
        ...(estimated && { estimated }),
      })
      .catch(() => console.error("search: judging cost not recorded"));
  return {
    async judge(query, candidates, signal) {
      const [spent, limit, texts] = await Promise.all([
        spend.spentTodayMicros(),
        spend.dailyBudgetMicros(),
        describe(
          candidates.map((c) => c.id),
          JUDGING.jevCandidateChars
        ),
      ]);
      if (spent >= limit) return new Map();
      const sendable = candidates.filter((c) => texts.get(c.id));
      if (!sendable.length) return new Map();
      const sent = sendable.map((c) => texts.get(c.id)!);
      let reply;
      try {
        reply = await client.judge(query, sent, signal);
      } catch (error) {
        // It may still have been billed: count the most it could have cost.
        await record(jevTokenEstimate(query + sent.join("")), true);
        throw error;
      }
      await record(reply.inputTokens);
      return new Map(
        sendable.map((c, i) => [
          c.id,
          (reply.probabilities[i] ?? 0) >= JUDGING.jevThreshold
            ? "direct"
            : "related",
        ])
      );
    },
  };
}
