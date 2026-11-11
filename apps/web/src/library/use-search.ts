import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  requestKey,
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
/** `key` names the search the results answer (requestKey). */
export type Results = {
  direct: Found[];
  related: Found[];
  mode: Mode;
  key: string;
};

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
      : await api.api.search.$get(
          {
            query: {
              q: request.query,
              ...(mode === "full" && { mode: "full" }),
            },
          },
          init
        );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { results: Hit[]; mode?: Mode };
  // A full search that fell back to keywords says so: shown, not kept.
  return {
    hits: body.results,
    final: mode === "instant" || body.mode !== "instant",
  };
}

/** Full answers, shared by the ⌘K menu and the wall, per account. */
const cache = new Map<string, Hit[]>();

/** Forgets every search answer: on sign-out, nothing of one Library stays. */
export const clearSearchCache = () => cache.clear();

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
  version: number,
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
      cache,
      scope: userId,
    })
  );
  const query = request && "query" in request ? request.query.trim() : "";
  const like = request && "like" in request ? request.like : "";

  useEffect(() => {
    session.set(like ? { like } : query ? { query } : undefined, version);
  }, [session, query, like, version]);
  useEffect(() => () => session.stop(), [session]);

  return useMemo((): Results | "failed" | undefined => {
    const current = like
      ? requestKey({ like })
      : query
        ? requestKey({ query })
        : undefined;
    const shown = shownAnswer(answer, current, keepPrevious);
    if (!shown) return undefined;
    if ("failed" in shown) return "failed";
    const wall = new Map(memories.map((m) => [m.id, m]));
    const results: Results = {
      direct: [],
      related: [],
      mode: shown.mode,
      key: shown.key,
    };
    for (const hit of shown.hits) {
      const memory = wall.get(hit.id);
      if (memory) results[hit.match].push({ ...memory, part: hit.part });
    }
    return results;
  }, [answer, query, like, memories, keepPrevious]);
}
