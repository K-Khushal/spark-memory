import { FREE_ALLOWANCE } from "./allowance";
import type { LinkMetadata } from "./link";
import type { MemoryKind } from "./memory";

/**
 * Deep fetch (GLOSSARY.md, ADR-0010): the heavier second attempt at a
 * Memory's content when Gather came back thin. One place for its limits.
 */
export const DEEP_FETCH = {
  /** Waits after the first and second attempt; a third failure is final. */
  retryDelaysSeconds: [3600, 86400],
  /** A job running longer than this has died; its row may be taken again. */
  leaseMinutes: 10,
  /** Queued this soon counts as Fetching, so the wall keeps asking. */
  soonSeconds: 300,
  /** Queues delays a message 24 hours at most: longer waits rely on the sweep. */
  maxQueueDelaySeconds: 12 * 3600,
  /** Memories the hourly sweep sends at most. */
  sweepBatch: 50,
  /**
   * What each engine may spend of its free tier (docs/research/deep-fetch.md),
   * a little under the real limit. Past it, jobs wait for the next window.
   * `page` is Browser Rendering's browser time (10 minutes a UTC day on the
   * free plan); `media` is the container's CPU time (about 180,000 vCPU
   * seconds a month, one vCPU).
   */
  budgets: {
    page: { per: "day", seconds: 540 },
    media: { per: "month", seconds: 150_000 },
  },
  /** Per person, per UTC day (the Free allowance). */
  perDay: FREE_ALLOWANCE.deepFetchesPerDay,
} as const;

/** Browser Rendering loads pages; the Cloud Run fetcher handles video and audio. */
export type DeepFetchEngine = keyof typeof DEEP_FETCH.budgets;

/** Stored on the Memory. `done` and a Memory never thin are both just "nothing to show". */
export type DeepFetchState =
  "queued" | "running" | "done" | "failed" | "unavailable";

/**
 * What the Memory shows (null when there is nothing to say). Worked out by
 * the database (`baseColumns.deepFetch`): running, or queued to run within
 * `soonSeconds`, is Fetching; queued for later is Waiting.
 */
export type DeepFetchView = "fetching" | "waiting" | "failed" | "unavailable";

/** Why an attempt found nothing; only `retry` ones are worth another go. */
export type DeepFetchFailure =
  "not_public" | "too_long" | "nothing" | "error" | "limit";

/** The engine that handles a Memory of this kind, if Deep fetch applies to it. */
export function engineFor(kind: MemoryKind): DeepFetchEngine | undefined {
  if (kind === "link") return "page";
  if (kind === "video") return "media";
  return undefined;
}

/**
 * Whether gathering a link or video came back thin (ADR-0010): no readable
 * text (a login wall or an app shell), no image, or a video without a
 * transcript. A video over the transcript allowance is not thin: no engine
 * would be asked for it.
 */
export function isThin(found: {
  kind: MemoryKind;
  text: string | null;
  metadata: LinkMetadata;
}): boolean {
  if (found.kind === "video") {
    return found.metadata.video?.transcriptState === "unavailable";
  }
  if (found.kind === "link") return !found.text || !found.metadata.imageUrl;
  return false;
}

/**
 * Seconds to wait before the next automatic attempt, after `attempts`
 * attempts have run; undefined once they are used up.
 */
export const retryDelaySeconds = (attempts: number): number | undefined =>
  DEEP_FETCH.retryDelaysSeconds[attempts - 1];

/** The window an engine's budget is counted in, as a key, and when the next begins. */
export function budgetWindow(engine: DeepFetchEngine, now: Date) {
  const { per } = DEEP_FETCH.budgets[engine];
  const iso = now.toISOString();
  const next =
    per === "day"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return {
    key: per === "day" ? iso.slice(0, 10) : iso.slice(0, 7),
    secondsToNext: Math.max(1, Math.ceil((next - now.getTime()) / 1000)),
  };
}
