import {
  budgetWindow,
  DEEP_FETCH,
  engineFor,
  FREE_ALLOWANCE,
  INDEXING,
  MIN_PRESERVED_CHARS,
  retryDelaySeconds,
  secondsToNextUtcDay,
  type DeepFetchEngine,
  type DeepFetchFailure,
  type LinkMetadata,
  type MemoryKind,
  type TranscriptSegment,
} from "@spark/core";
import type { DeepFetch, EngineUsage, Fetched } from "./engine";

/** The attempt a store handed out: every write names it. */
export type Claim = {
  memoryId: string;
  userId: string;
  generation: string;
  run: number;
};

/** What an attempt found, as the store keeps it. */
type Found = {
  text?: string;
  metadata?: LinkMetadata;
  transcript?: TranscriptSegment[];
};

/** A Memory whose Indexing starts over with what was found. */
export type Reindex = {
  id: string;
  indexRun: number;
  indexGeneration: string;
  indexPriority: "fresh" | "background";
};

/** Where Deep fetch reads and writes (structurally @spark/db's `deepFetchStore`). */
export type DeepFetchJobStore = {
  claim(
    memoryId: string,
    generation: string,
    run: number
  ): Promise<
    | {
        claim: Claim;
        kind: MemoryKind;
        url: string;
        aiOptOut: boolean;
        attempts: number;
        hasText: boolean;
      }
    | undefined
  >;
  takeSlot(userId: string): Promise<boolean>;
  giveBackSlot(userId: string): Promise<void>;
  usedSeconds(engine: DeepFetchEngine, window: string): Promise<number>;
  addSeconds(
    engine: DeepFetchEngine,
    window: string,
    seconds: number
  ): Promise<void>;
  done(
    claim: Claim,
    found?: Found
  ): Promise<(Reindex & { reindex: boolean }) | undefined>;
  retry(
    claim: Claim,
    options: { delaySeconds: number; attempt: boolean }
  ): Promise<boolean>;
  fail(claim: Claim, error: DeepFetchFailure): Promise<boolean>;
  unavailable(claim: Claim): Promise<boolean>;
  stop(claim: Claim): Promise<boolean>;
};

/** The daily AI budget and its ledger (structurally @spark/db's `indexingStore`). */
export type DeepFetchAi = {
  spentTodayMicros(): Promise<number>;
  dailyBudgetMicros(): Promise<number>;
  recordCall(call: {
    userId: string;
    memoryId: string;
    memoryGeneration: string;
    provider: "gemini";
    model: string;
    usage: { inputTokens: number; outputTokens: number };
    costMicros: number;
  }): Promise<void>;
};

/** What one job did, for the queue adapter. */
export type DeepFetchOutcome =
  | { result: "skipped" | "stopped" | "unavailable" | "failed" }
  /** Found something; `reindex` is set when Indexing starts over. */
  | { result: "done"; reindex?: Reindex }
  /** Queued again, due in `delaySeconds`: the adapter sends a delayed message. */
  | { result: "later"; delaySeconds: number };

const costMicros = (model: string, usage: EngineUsage) => {
  const [input, output] = INDEXING.pricesMicrosPerMTokens[model] ?? [0, 0];
  return Math.ceil(
    (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000
  );
};

/**
 * One Deep fetch job (ADR-0010) behind one call: take the Memory if it is
 * due, then choose the engine for its kind, honour the person's 20 a day,
 * the engine's free tier and (for video, which sends audio to a model) the
 * daily AI budget, ask the engine, and write what came back or schedule the
 * next attempt: after one hour, then 24 hours, then Failed. Past a limit the
 * job waits for the next window without using an attempt. Never logs in.
 * No lock is held while an engine works: the claim is a lease.
 */
export function createDeepFetchWorker({
  store,
  ai,
  deepFetch,
  keepScreenshot,
  now = () => new Date(),
}: {
  store: DeepFetchJobStore;
  ai: DeepFetchAi;
  deepFetch: DeepFetch;
  /** Keeps a page's screenshot as the Memory's (best effort: false or a throw changes nothing). */
  keepScreenshot?: (
    claim: Claim,
    screenshot: NonNullable<Fetched["screenshot"]>
  ) => Promise<boolean>;
  now?: () => Date;
}) {
  async function run(job: {
    memoryId: string;
    generation: string;
    run: number;
  }): Promise<DeepFetchOutcome> {
    const taken = await store.claim(job.memoryId, job.generation, job.run);
    if (!taken) return { result: "skipped" };
    const { claim, kind, url, aiOptOut, attempts, hasText } = taken;
    const engine = engineFor(kind);
    // Video goes to a model: never for AI opt-out (switched on since queued).
    if (
      !engine ||
      (kind !== "link" && kind !== "video") ||
      (kind === "video" && aiOptOut)
    ) {
      await store.stop(claim);
      return { result: "stopped" };
    }
    if (!deepFetch.available(kind)) {
      await store.unavailable(claim);
      return { result: "unavailable" };
    }

    const wait = async (delaySeconds: number): Promise<DeepFetchOutcome> => {
      await store.retry(claim, { delaySeconds, attempt: false });
      return { result: "later", delaySeconds };
    };
    const window = budgetWindow(engine, now());
    if (
      (await store.usedSeconds(engine, window.key)) >=
      DEEP_FETCH.budgets[engine].seconds
    ) {
      // The free tier is spent: the next window, never a charge (ADR-0010).
      return wait(window.secondsToNext);
    }
    if (
      engine === "media" &&
      (await ai.spentTodayMicros()) >= (await ai.dailyBudgetMicros())
    ) {
      return wait(secondsToNextUtcDay(now()));
    }
    if (!(await store.takeSlot(claim.userId))) {
      return wait(secondsToNextUtcDay(now()));
    }

    const result = await deepFetch.fetch({
      url,
      kind,
      maxMinutes: FREE_ALLOWANCE.videoTranscriptMaxMinutes,
    });
    // What it used is spent whether or not it found anything.
    if (result.seconds > 0) {
      await store.addSeconds(engine, window.key, result.seconds);
    }
    for (const usage of result.usage ?? []) {
      await ai
        .recordCall({
          userId: claim.userId,
          memoryId: claim.memoryId,
          memoryGeneration: claim.generation,
          provider: "gemini",
          model: usage.model,
          usage,
          costMicros: costMicros(usage.model, usage),
        })
        .catch(() => console.error("deep fetch: AI call cost not recorded"));
    }

    if (!result.ok) {
      if (result.reason === "limit") {
        // The engine itself is out of free tier: give the slot back and wait.
        await store.giveBackSlot(claim.userId);
        return wait(window.secondsToNext);
      }
      if (result.reason === "unavailable") {
        // The engine is not set up to do this (no transcript key): nothing
        // was tried, so no slot and no attempt is spent.
        await store.giveBackSlot(claim.userId);
        await store.unavailable(claim);
        return { result: "unavailable" };
      }
      if (result.reason === "not_public" || result.reason === "too_long") {
        await store.fail(claim, result.reason);
        return { result: "failed" };
      }
      return nextAttempt(claim, attempts, result.reason);
    }

    // A link that already has text is fetched again for what it lacks (its
    // screenshot): its text is never replaced, so Indexing is not run again.
    const wantsText = !(kind === "link" && hasText);
    const text = !wantsText
      ? undefined
      : (result.text ??
        (result.transcript?.length
          ? result.transcript.map((s) => s.text).join("\n")
          : undefined));
    const readable =
      !!text &&
      (result.transcript?.length || text.length >= MIN_PRESERVED_CHARS);
    const found =
      wantsText &&
      (readable || result.metadata?.title || result.metadata?.description)
        ? {
            ...(readable && {
              text: text.slice(0, FREE_ALLOWANCE.textMaxChars),
            }),
            ...(result.metadata && { metadata: result.metadata }),
            ...(result.transcript?.length && { transcript: result.transcript }),
          }
        : undefined;
    let kept = false;
    if (result.screenshot && keepScreenshot) {
      kept = await keepScreenshot(claim, result.screenshot).catch(() => false);
    }
    if (!found && !kept) return nextAttempt(claim, attempts, "nothing");
    const done = await store.done(claim, found);
    return {
      result: "done",
      ...(done?.reindex && {
        reindex: {
          id: done.id,
          indexRun: done.indexRun,
          indexGeneration: done.indexGeneration,
          indexPriority: done.indexPriority,
        },
      }),
    };
  }

  /** Attempt `attempts + 1` found nothing: wait for the next, or Fail after the last. */
  async function nextAttempt(
    claim: Claim,
    attempts: number,
    reason: DeepFetchFailure
  ): Promise<DeepFetchOutcome> {
    const delaySeconds = retryDelaySeconds(attempts + 1);
    if (delaySeconds === undefined) {
      await store.fail(claim, reason);
      return { result: "failed" };
    }
    await store.retry(claim, { delaySeconds, attempt: true });
    return { result: "later", delaySeconds };
  }

  return { run };
}

export type DeepFetchWorker = ReturnType<typeof createDeepFetchWorker>;
