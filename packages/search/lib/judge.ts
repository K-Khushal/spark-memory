import {
  JUDGING,
  type Hold,
  thresholdMatch,
  type MatchSignals,
  type MatchThresholds,
  type Verdict,
} from "@spark/core";
import {
  jevCostMicros,
  jevTokenEstimate,
  type AiCall,
  type JudgeClient,
} from "@spark/indexing";

/** A result as a judge sees it: its id and what the search legs said of it. */
export type Candidate = MatchSignals & { id: string };
export type { Verdict };

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
    /** Holds the call's cost (an upper bound) first; refused when no budget is left for it. */
    reserve(input: { userId: string; micros: number }): Promise<Hold>;
    releaseHold(id: string): Promise<void>;
    recordCall(call: AiCall): Promise<void>;
  };
}): MatchJudge {
  const record = (
    id: string,
    inputTokens: number,
    reservation: string,
    estimated = false
  ) =>
    spend.recordCall({
      id,
      reservation,
      userId,
      memoryId: null,
      provider: "jev",
      model: client.model,
      usage: { inputTokens, outputTokens: 0 },
      costMicros: jevCostMicros(client.model, inputTokens),
      ...(estimated && { estimated }),
    });
  return {
    async judge(query, candidates, signal) {
      const texts = await describe(
        candidates.map((c) => c.id),
        JUDGING.jevCandidateChars
      );
      const sendable = candidates.filter((c) => texts.get(c.id));
      if (!sendable.length) return new Map();
      const sent = sendable.map((c) => texts.get(c.id)!);
      // Held before the call: no budget left, or the person's share is spent.
      const held = jevCostMicros(
        client.model,
        jevTokenEstimate(query + sent.join(""))
      );
      const hold = await spend.reserve({ userId, micros: held });
      if ("refused" in hold) return new Map();
      // The deadline passed while the texts and budget were read: no call
      // was made, so nothing may be recorded as spent.
      // No call is made if it already ended: the hold goes back.
      if (signal.aborted) {
        await spend.releaseHold(hold.id).catch(() => {});
        signal.throwIfAborted();
      }
      const id = crypto.randomUUID();
      // Persist before starting the billable call: a timeout can end the Worker.
      // If persistence fails, do not spend. A successful reply reconciles this row.
      try {
        await record(
          id,
          jevTokenEstimate(query + sent.join("")),
          hold.id,
          true
        );
      } catch (error) {
        await spend.releaseHold(hold.id).catch(() => {});
        throw error;
      }
      signal.throwIfAborted();
      const reply = await client.judge(query, sent, signal);
      await record(id, reply.inputTokens, hold.id).catch(() =>
        console.error("search: judging estimate not reconciled")
      );
      // A question Jev left unanswered is not ruled on: the thresholds stand.
      return new Map(
        sendable.flatMap((c, i): [string, Verdict][] => {
          const probability = reply.probabilities[i];
          return probability === undefined
            ? []
            : [
                [
                  c.id,
                  probability >= JUDGING.jevThreshold ? "direct" : "related",
                ],
              ];
        })
      );
    },
  };
}
