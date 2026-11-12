/** Instant: keyword and typo, per keystroke. Full: with meaning, after a pause. */
export type Mode = "instant" | "full";

/** What to search for: words typed, or a Memory to find More Like This of. */
export type SearchRequest =
  { query: string; colour?: string; offset?: number } | { like: string };

/** What matched in a result (migrations/0013_hybrid_search.sql). */
/** What matched (packages/db MatchedPart); `page` is a PDF's page. */
export type MatchedPart =
  | { kind: "field"; field?: string; page?: number }
  | {
      kind: "passage";
      field: "body" | "ocr";
      start: number;
      end: number;
      page?: number;
      timestamp?: number;
    }
  | { kind: "filter"; field: "colour" | "source" | "kind" | "date" }
  | { kind: "overview" }
  | { kind: "visual"; page?: number };

export type Hit = {
  id: string;
  match: "direct" | "related";
  part: MatchedPart | null;
};

export type Answer =
  | { key: string; mode: Mode; hits: Hit[] }
  | { key: string; mode: Mode; failed: true };

export const requestKey = (request: SearchRequest) =>
  "like" in request
    ? `like:${request.like}`
    : `q:${request.query}${request.colour ? `|colour:${request.colour}` : ""}${request.offset ? `|offset:${request.offset}` : ""}`;

const CACHE_SIZE = 50;

let generations = 0;

/**
 * Versions for one Library mount: `version(n)` names its n-th change. Each
 * mount gets a generation no earlier mount had, so a page opened again
 * (back from Settings) never reuses an answer cached before it, which
 * would miss what was Indexed meanwhile.
 */
export function libraryVersion() {
  const generation = ++generations;
  return (changes: number) => `${generation}.${changes}`;
}

/**
 * Full answers in this tab, shared by the ⌘K menu and the wall, keyed by
 * `${scope}|${generation}|${requestKey}` (searchSession).
 */
export const searchCache = new Map<string, Hit[]>();

/** Bumped by every clear: an answer still in flight then is never kept. */
let cacheEpoch = 0;

/** Forgets every search answer: when a session ends (endSession). */
export const clearSearchCache = () => {
  cacheEpoch++;
  searchCache.clear();
};

/**
 * Which answer a search may show for the `current` request (requestKey):
 * its own, or, in the menu, one to the start of what is being typed (it
 * stays steady as letters are added). `keepPrevious` (the wall) keeps the
 * last results up until the new answer lands, so the wall never empties;
 * a failure shows only for the search it belongs to.
 */
export function shownAnswer(
  answer: Answer | undefined,
  current: string | undefined,
  keepPrevious: boolean
): Answer | undefined {
  if (!answer || !current) return undefined;
  const own =
    answer.key === current ||
    (answer.key.startsWith("q:") && current.startsWith(answer.key));
  if (own) return answer;
  return keepPrevious && !("failed" in answer) ? answer : undefined;
}

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
  scope,
}: {
  /** `final: false` when a full search fell back to keywords: shown, never cached. */
  fetch: (
    request: SearchRequest,
    mode: Mode,
    signal: AbortSignal
  ) => Promise<{ hits: Hit[]; final: boolean }>;
  onAnswer: (answer: Answer | undefined) => void;
  pauseMs: number;
  /** Full answers by `${scope}|${version}|${requestKey}`, shared between sessions. */
  cache: Map<string, Hit[]>;
  /** Whose Library: answers are never shared between accounts. */
  scope: string;
}) {
  let stop = () => {};

  /** `version` names the Library's state (libraryVersion): a new one searches again. */
  function set(request: SearchRequest | undefined, version: string) {
    stop();
    if (!request) {
      stop = () => {};
      onAnswer(undefined);
      return;
    }
    const key = requestKey(request);
    const cacheKey = `${scope}|${version}|${key}`;
    const epoch = cacheEpoch;
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
        if (mode === "full" && final && epoch === cacheEpoch) {
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
