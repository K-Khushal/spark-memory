import { useEffect, useMemo, useState } from "react";
import type { SearchChips } from "@spark/core";
import { toast } from "@spark/ui";
import { api } from "../api";
import {
  requestKey,
  searchCache,
  searchSession,
  shownAnswer,
  type Answer,
  type Hit,
  type MatchedPart,
  type Mode,
  type SearchRequest,
} from "./search-session";
import type { Memory } from "./use-library";

export type { MatchedPart, SearchRequest } from "./search-session";

/** A result: the wall's own copy of the Memory, and what matched in it. */
export type Found = Memory & { part: MatchedPart | null };
/**
 * `key` names the search the results answer (requestKey); `total` is how
 * many hits the server sent (some may not be on the wall), for paging.
 */
export type Results = {
  direct: Found[];
  related: Found[];
  mode: Mode;
  key: string;
  total: number;
};

/** What the server sends per page. */
export const PAGE_SIZE = 40;

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The request as the search route reads it. */
const searchParams = (
  request: Exclude<SearchRequest, { like: string }>,
  mode: Mode | undefined,
  offset?: number
) => ({
  q: request.query,
  ...request.chips,
  timezone: timezone(),
  ...(mode === "full" && { mode }),
  ...(offset && { offset: String(offset) }),
});

/** How long typing pauses before the full search (with meaning) runs. */
export const FULL_SEARCH_PAUSE_MS = 350;

const byId = api.api.memories[":id"];

async function fetchHits(
  request: SearchRequest,
  mode: Mode,
  signal: AbortSignal
): Promise<{ hits: Hit[]; final: boolean }> {
  const init = { init: { signal } };
  const res =
    "like" in request
      ? await byId.similar.$get({ param: { id: request.like } }, init)
      : await api.api.search.$get({ query: searchParams(request, mode) }, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { results: Hit[]; mode?: Mode };
  // A full search that fell back to keywords says so: shown, not kept.
  return {
    hits: body.results,
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
 * deletes stay hidden. `version` goes up when the Library changes (an
 * accepted edit, Indexing finished, AI opt-out): the search runs again.
 */
export function useSearch(
  request: SearchRequest | undefined,
  memories: Memory[],
  version: string,
  {
    userId,
    pauseMs = FULL_SEARCH_PAUSE_MS,
    keepPrevious = false,
  }: { userId: string; pauseMs?: number; keepPrevious?: boolean }
) {
  const [answer, setAnswer] = useState<Answer>();
  const [session] = useState(() =>
    searchSession({
      fetch: fetchHits,
      onAnswer: setAnswer,
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
  const wanted = useMemo((): SearchRequest | undefined => {
    if (like) return { like };
    if (!query && !chipsJson) return undefined;
    return {
      query,
      ...(chipsJson && { chips: JSON.parse(chipsJson) as SearchChips }),
    };
  }, [like, query, chipsJson]);
  useEffect(() => {
    session.set(wanted, version);
  }, [session, wanted, version]);
  useEffect(() => () => session.stop(), [session]);

  return useMemo((): Results | "failed" | undefined => {
    const current = wanted && requestKey(wanted);
    const shown = shownAnswer(answer, current, keepPrevious);
    if (!shown) return undefined;
    if ("failed" in shown) return "failed";
    const wall = new Map(memories.map((m) => [m.id, m]));
    const results: Results = {
      direct: [],
      related: [],
      mode: shown.mode,
      key: shown.key,
      total: shown.hits.length,
    };
    for (const hit of shown.hits) {
      const memory = wall.get(hit.id);
      if (memory) results[hit.match].push({ ...memory, part: hit.part });
    }
    return results;
  }, [answer, wanted, memories, keepPrevious]);
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
  memories: Memory[]
) {
  const key = shown && shown !== "failed" ? shown.key : undefined;
  const [more, setMore] = useState<{
    key: string;
    hits: Hit[];
    done: boolean;
    busy: boolean;
  }>();
  const own = more?.key === key ? more : undefined;
  const first = shown && shown !== "failed" ? shown : undefined;
  const canLoad =
    !!first &&
    !!request &&
    "query" in request &&
    // Words are paged once the full answer is in, so pages do not reorder.
    (first.mode === "full" || !request.query.trim()) &&
    !own?.done &&
    !own?.busy &&
    first.total >= PAGE_SIZE;

  const load = async () => {
    if (!canLoad || !request || !("query" in request) || !key) return;
    setMore({ key, hits: own?.hits ?? [], done: false, busy: true });
    const offset = first.total + (own?.hits.length ?? 0);
    try {
      const mode = request.query.trim() ? "full" : undefined;
      const res = await api.api.search.$get({
        query: searchParams(request, mode, offset),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { results } = (await res.json()) as { results: Hit[] };
      setMore((current) =>
        current?.key === key
          ? {
              key,
              hits: [...current.hits, ...results],
              done: results.length < PAGE_SIZE,
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
    const wall = new Map(memories.map((m) => [m.id, m]));
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
  }, [own, memories]);

  return { ...extra, canLoad, busy: !!own?.busy, load };
}
