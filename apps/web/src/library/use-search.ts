import { useEffect, useMemo, useState } from "react";
import type { SearchChips } from "@spark/core";
import { toast } from "@spark/ui";
import { api } from "../api";
import { sharedFlight, type Flight } from "./shared-flight";
import {
  requestKey,
  searchCache,
  searchSession,
  shownAnswer,
  type Answer,
  type Hit,
  type MatchedPart,
  type Mode,
  type Page,
  type SearchRequest,
} from "./search-session";
import type { Memory } from "./use-library";

export type { MatchedPart, SearchRequest } from "./search-session";

/** A result: the wall's own copy of the Memory, and what matched in it. */
export type Found = Memory & { part: MatchedPart | null };
/**
 * `key` names the search the results answer (requestKey); `next` is where
 * the next page begins, as the server said, when there is one.
 */
export type Results = {
  direct: Found[];
  related: Found[];
  mode: Mode;
  /** No later answer is coming: the full one is here, or it failed. */
  settled: boolean;
  key: string;
  next?: string;
};

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The body of a search POST: words and chips go in it, never in a URL. */
const searchBody = (
  request: Exclude<SearchRequest, { like: string }>,
  mode: Mode,
  page?: string
) => ({
  q: request.query,
  ...(request.visual &&
    ("image" in request.visual
      ? { image: request.visual.image }
      : { memory: request.visual.memory })),
  mode,
  timezone: timezone(),
  ...(request.chips && { chips: request.chips }),
  ...(page && { page }),
});

type SearchAnswer = { results: Hit[]; mode?: Mode; next?: string };

/** How long typing pauses before the full search (with meaning) runs. */
export const FULL_SEARCH_PAUSE_MS = 350;

const byId = api.api.memories[":id"];

type Fetched = Page & { final: boolean };

/** Searches in the air, shared by the menu and the wall when both ask the same thing at once. */
const flights = new Map<string, Flight<Fetched>>();

/** `version` names the Library's state (libraryVersion): a request is only shared within one. */
const fetchHits = (
  request: SearchRequest,
  mode: Mode,
  signal: AbortSignal,
  version: string
): Promise<Fetched> =>
  sharedFlight(
    flights,
    `${version}|${mode}|${requestKey(request)}`,
    (own) => sendSearch(request, mode, own),
    signal
  );

async function sendSearch(
  request: SearchRequest,
  mode: Mode,
  signal: AbortSignal
): Promise<Fetched> {
  const init = { init: { signal } };
  const res =
    "like" in request
      ? await byId.similar.$get({ param: { id: request.like } }, init)
      : await api.api.search.$post({ json: searchBody(request, mode) }, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as SearchAnswer;
  // A full search that fell back to keywords says so: shown, not kept.
  return {
    hits: body.results,
    ...(body.next && { next: body.next }),
    final: mode === "instant" || body.mode !== "instant",
  };
}

/**
 * Search as the person types (searchSession): an instant answer per
 * keystroke, the full one once typing pauses (`pauseMs`; 0 on the wall).
 * Results keep their keys (Memory ids) so they move instead of swapping,
 * and only an answer to this search shows (shownAnswer); `keepPrevious`
 * (the wall) keeps the last results up until the new ones land. Hits are
 * read through the wall's own Memories, so local edits show and pending
 * deletes stay hidden. `retry` asks again after a failure (`retrying` until
 * the answer lands). `version` goes up when the Library changes (an
 * accepted edit, Indexing finished, AI opt-out): the search runs again.
 */
export function useSearch(
  request: SearchRequest | undefined,
  wall: ReadonlyMap<string, Memory>,
  version: string,
  {
    userId,
    pauseMs = FULL_SEARCH_PAUSE_MS,
    keepPrevious = false,
  }: { userId: string; pauseMs?: number; keepPrevious?: boolean }
) {
  const [answer, setAnswer] = useState<Answer>();
  /** Between Try Again and the next answer: the failure stays up, marked busy. */
  const [retrying, setRetrying] = useState(false);
  const [session] = useState(() =>
    searchSession({
      fetch: fetchHits,
      onAnswer: (next) => {
        setAnswer(next);
        setRetrying(false);
      },
      pauseMs,
      cache: searchCache,
      scope: userId,
    })
  );
  const query = request && "query" in request ? request.query.trim() : "";
  const like = request && "like" in request ? request.like : "";
  // Chips by value, so a new object with the same choices is the same search.
  const chipsJson =
    request && "chips" in request && request.chips
      ? JSON.stringify(request.chips)
      : "";
  const visual = request && "query" in request ? request.visual : undefined;
  const wanted = useMemo((): SearchRequest | undefined => {
    if (like) return { like };
    if (!query && !chipsJson && !visual) return undefined;
    return {
      query,
      ...(visual && { visual }),
      ...(chipsJson && { chips: JSON.parse(chipsJson) as SearchChips }),
    };
  }, [like, query, chipsJson, visual]);
  useEffect(() => {
    session.set(wanted, version);
  }, [session, wanted, version]);
  useEffect(() => () => session.stop(), [session]);

  const results = useMemo((): Results | "failed" | undefined => {
    const current = wanted && requestKey(wanted);
    const shown = shownAnswer(answer, current, keepPrevious);
    if (!shown) return undefined;
    if ("failed" in shown) return "failed";
    const found: Results = {
      direct: [],
      related: [],
      mode: shown.mode,
      settled: shown.mode === "full" || !!shown.settled,
      key: shown.key,
      ...(shown.next && { next: shown.next }),
    };
    for (const hit of shown.hits) {
      const memory = wall.get(hit.id);
      if (memory) found[hit.match].push({ ...memory, part: hit.part });
    }
    return found;
  }, [answer, wanted, wall, keepPrevious]);
  const retry = () => {
    setRetrying(true);
    // Nothing to ask again when no search is set (the menu is closed).
    if (!session.retry()) setRetrying(false);
  };
  return { results, retry, retrying };
}

/**
 * Further pages of the search on the wall, one at a time on request
 * ("Show More"). A page is fetched from where the last one ended, in the
 * same mode the first page was answered in, so nothing repeats or moves;
 * a different search (key) starts over.
 */
export function useMoreResults(
  request: SearchRequest | undefined,
  shown: Results | "failed" | undefined,
  wall: ReadonlyMap<string, Memory>
) {
  const first = shown && shown !== "failed" ? shown : undefined;
  const key = first?.key;
  const [more, setMore] = useState<{
    key: string;
    hits: Hit[];
    next?: string;
    busy: boolean;
  }>();
  const own = more?.key === key ? more : undefined;
  // The page after the last one shown; none once a page said it was the last.
  const next = own ? own.next : first?.next;
  const canLoad =
    !!request &&
    "query" in request &&
    !!next &&
    !own?.busy &&
    // Words are paged once the full answer is in, so pages do not reorder.
    (first?.mode === "full" || !request.query.trim());

  const load = async () => {
    if (!canLoad || !key || !next) return;
    setMore({ key, hits: own?.hits ?? [], busy: true });
    try {
      const res = await api.api.search.$post({
        json: searchBody(
          request,
          request.query.trim() || request.visual ? "full" : "instant",
          next
        ),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SearchAnswer;
      setMore((current) =>
        current?.key === key
          ? {
              key,
              hits: [...current.hits, ...body.results],
              ...(body.next && { next: body.next }),
              busy: false,
            }
          : current
      );
    } catch {
      setMore((current) =>
        current?.key === key ? { ...current, busy: false } : current
      );
      toast.error("Could Not Load More");
    }
  };

  const extra = useMemo(() => {
    const found: Results["direct"] = [];
    const related: Results["related"] = [];
    for (const hit of own?.hits ?? []) {
      const memory = wall.get(hit.id);
      if (memory)
        (hit.match === "direct" ? found : related).push({
          ...memory,
          part: hit.part,
        });
    }
    return { direct: found, related };
  }, [own, wall]);

  return { ...extra, canLoad, busy: !!own?.busy, load };
}
