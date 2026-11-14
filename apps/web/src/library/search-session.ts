import type { ImageQuery } from "./image-query";
import type { SearchChips } from "@spark/core";

/** Instant: keyword and typo, per keystroke. Full: with meaning, after a pause. */
export type Mode = "instant" | "full";

/**
 * What to search for: words typed and/or filter chips (either may be
 * empty, not both), or a Memory to find More Like This of.
 */
export type SearchRequest =
  | { query: string; chips?: SearchChips; visual?: ImageQuery }
  | { like: string };

/** What matched (packages/db MatchedPart); `page` is a PDF's page. */
export type MatchedPart =
  | { kind: "field"; field?: string; page?: number }
  | {
      kind: "passage";
      field: "body" | "ocr";
      start: number;
      end: number;
      page?: number;
      seconds?: number;
    }
  /** Found by a filter chip alone: `value` is a palette colour, host, capture time, kind or Category. */
  | {
      kind: "filter";
      field: "colour" | "source" | "kind" | "date" | "category";
      value: string;
    }
  | { kind: "overview" }
  | { kind: "visual"; page?: number };

export type Hit = {
  id: string;
  match: "direct" | "related";
  part: MatchedPart | null;
};

/** One page of a search's answer, and where the next begins (the server's `next`). */
export type Page = { hits: Hit[]; next?: string };

export type Answer =
  | ({ key: string; mode: Mode } & Page)
  | { key: string; mode: Mode; failed: true };

/** Chips key as `f:` so only an identical search, never a prefix, answers for them. */
export const requestKey = (request: SearchRequest) => {
  if ("like" in request) return `like:${request.like}`;
  if (request.visual)
    return `image:${request.visual.id}|${JSON.stringify(request.chips ?? {})}|${request.query}`;
  const chips = Object.entries(request.chips ?? {}).sort();
  return chips.length
    ? `f:${chips.map(([k, v]) => `${k}=${v}`).join("&")}|${request.query}`
    : `q:${request.query}`;
};

/** Whether a request's key (requestKey) is filters alone, with no words. */
export const isWordless = (key: string) =>
  key.startsWith("f:") && key.endsWith("|");

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
export const searchCache = new Map<string, Page>();

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
    signal: AbortSignal,
    version: string
  ) => Promise<Page & { final: boolean }>;
  onAnswer: (answer: Answer | undefined) => void;
  pauseMs: number;
  /** Full answers by `${scope}|${version}|${requestKey}`, shared between sessions. */
  cache: Map<string, Page>;
  /** Whose Library: answers are never shared between accounts. */
  scope: string;
}) {
  let stop = () => {};
  let last: { request: SearchRequest; version: string } | undefined;

  /** `version` names the Library's state (libraryVersion): a new one searches again. */
  function set(request: SearchRequest | undefined, version: string) {
    stop();
    last = request && { request, version };
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
      onAnswer({ key, mode: "full", ...cached });
      return;
    }
    const controller = new AbortController();
    // Each mode's request: waiting, answered (ok), failed, or not made.
    type Step = "waiting" | "ok" | "failed" | "none";
    // Filters alone have no words to find by meaning: the instant answer is the answer.
    const wordless =
      "query" in request && !request.query.trim() && !request.visual;
    const step: Record<Mode, Step> = {
      instant: "query" in request && !request.visual ? "waiting" : "none",
      full: wordless ? "none" : "waiting",
    };
    const done = (mode: Mode, page?: Page, final = true) => {
      if (controller.signal.aborted) return;
      step[mode] = page ? "ok" : "failed";
      const other = step[mode === "full" ? "instant" : "full"];
      if (page && (mode === "full" || other !== "ok")) {
        onAnswer({ key, mode, ...page });
        if ((mode === "full" || wordless) && final && epoch === cacheEpoch) {
          cache.set(cacheKey, page);
          if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
        }
      } else if (!page && (other === "failed" || other === "none")) {
        onAnswer({ key, mode, failed: true });
      }
    };
    const run = (mode: Mode) =>
      fetch(request, mode, controller.signal, version).then(
        ({ final, ...page }) => done(mode, page, final),
        () => done(mode)
      );
    if ("query" in request && !request.visual) void run("instant");
    if (wordless) {
      stop = () => controller.abort();
      return;
    }
    const pause = "like" in request ? 0 : pauseMs;
    const runFull = () => {
      // The wall may have found the full answer while this waited out the pause.
      const shared = cache.get(cacheKey);
      if (!shared) return void run("full");
      step.full = "ok";
      onAnswer({ key, mode: "full", ...shared });
    };
    const timer = pause ? setTimeout(runFull, pause) : undefined;
    if (!pause) void run("full");
    stop = () => {
      clearTimeout(timer);
      controller.abort();
    };
  }

  /** Asks again for the request last set: a failed answer is never cached, so it goes to the network. */
  const retry = () => {
    if (!last) return false;
    set(last.request, last.version);
    return true;
  };

  return { set, retry, stop: () => stop() };
}
