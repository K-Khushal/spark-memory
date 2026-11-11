/** Instant: keyword and typo, per keystroke. Full: with meaning, after a pause. */
export type Mode = "instant" | "full";

/** What to search for: words typed, or a Memory to find More Like This of. */
export type SearchRequest = { query: string } | { like: string };

/** What matched in a result (migrations/0012_hybrid_search.sql). */
export type MatchedPart =
  | { kind: "field"; field?: string }
  | { kind: "passage"; field: "body" | "ocr"; start: number; end: number }
  | { kind: "overview" | "visual" };

export type Hit = {
  id: string;
  match: "direct" | "related";
  part: MatchedPart | null;
};

export type Answer =
  | { key: string; mode: Mode; hits: Hit[] }
  | { key: string; mode: Mode; failed: true };

export const requestKey = (request: SearchRequest) =>
  "like" in request ? `like:${request.like}` : `q:${request.query}`;

const CACHE_SIZE = 50;

/**
 * One search box's requests, as one state machine: each `set` drops
 * whatever the previous one started. Words get an instant answer at once
 * and a full one once typing pauses for `pauseMs`; a full answer is final
 * (a late instant one never replaces it) and is cached per Library
 * `version`, so the wall reuses what the ⌘K menu already found. A failed
 * full search keeps the instant answer; failure is reported only when
 * nothing answered.
 */
export function searchSession({
  fetch,
  onAnswer,
  pauseMs,
  cache,
}: {
  /** `final: false` when a full search fell back to keywords: shown, never cached. */
  fetch: (
    request: SearchRequest,
    mode: Mode,
    signal: AbortSignal
  ) => Promise<{ hits: Hit[]; final: boolean }>;
  onAnswer: (answer: Answer | undefined) => void;
  pauseMs: number;
  /** Full answers by `${version}|${requestKey}`, shared between sessions. */
  cache: Map<string, Hit[]>;
}) {
  let stop = () => {};

  function set(request: SearchRequest | undefined, version: number) {
    stop();
    if (!request) {
      stop = () => {};
      onAnswer(undefined);
      return;
    }
    const key = requestKey(request);
    const cacheKey = `${version}|${key}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      stop = () => {};
      onAnswer({ key, mode: "full", hits: cached });
      return;
    }
    const controller = new AbortController();
    // Each mode's request: waiting, answered (ok), failed, or not made.
    type Step = "waiting" | "ok" | "failed" | "none";
    const step: Record<Mode, Step> = {
      instant: "query" in request ? "waiting" : "none",
      full: "waiting",
    };
    const done = (mode: Mode, hits?: Hit[], final = true) => {
      if (controller.signal.aborted) return;
      step[mode] = hits ? "ok" : "failed";
      const other = step[mode === "full" ? "instant" : "full"];
      if (hits && (mode === "full" || other !== "ok")) {
        onAnswer({ key, mode, hits });
        if (mode === "full" && final) {
          cache.set(cacheKey, hits);
          if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
        }
      } else if (!hits && (other === "failed" || other === "none")) {
        onAnswer({ key, mode, failed: true });
      }
    };
    const run = (mode: Mode) =>
      fetch(request, mode, controller.signal).then(
        ({ hits, final }) => done(mode, hits, final),
        () => done(mode)
      );
    if ("query" in request) void run("instant");
    const pause = "like" in request ? 0 : pauseMs;
    const timer = pause ? setTimeout(() => void run("full"), pause) : undefined;
    if (!pause) void run("full");
    stop = () => {
      clearTimeout(timer);
      controller.abort();
    };
  }

  return { set, stop: () => stop() };
}
