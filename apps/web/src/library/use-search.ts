import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  searchSession,
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
export type Results = { direct: Found[]; related: Found[]; mode: Mode };

/** How long typing pauses before the full search (with meaning) runs. */
export const FULL_SEARCH_PAUSE_MS = 350;

const byId = api.api.memories[":id"];

async function fetchHits(
  request: SearchRequest,
  mode: Mode,
  signal: AbortSignal
): Promise<Hit[]> {
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
  return ((await res.json()) as { results: Hit[] }).results;
}

/** Full answers, shared by the ⌘K menu and the wall. */
const cache = new Map<string, Hit[]>();

/**
 * Search as the person types (searchSession): an instant answer per
 * keystroke, the full one once typing pauses (`pauseMs`; 0 on the wall).
 * Until a new answer arrives the last one stays, so results never flash
 * empty, and they keep their keys (Memory ids) so they move instead of
 * swapping. Hits are read through the wall's own Memories, so local edits
 * show and pending deletes stay hidden. `version` goes up when the server
 * accepts a change: the search runs again.
 */
export function useSearch(
  request: SearchRequest | undefined,
  memories: Memory[],
  version: number,
  pauseMs = FULL_SEARCH_PAUSE_MS
) {
  const [answer, setAnswer] = useState<Answer>();
  const [session] = useState(() =>
    searchSession({ fetch: fetchHits, onAnswer: setAnswer, pauseMs, cache })
  );
  const query = request && "query" in request ? request.query.trim() : "";
  const like = request && "like" in request ? request.like : "";

  useEffect(() => {
    session.set(like ? { like } : query ? { query } : undefined, version);
  }, [session, query, like, version]);
  useEffect(() => () => session.stop(), [session]);

  return useMemo((): Results | "failed" | undefined => {
    if (!answer || (!query && !like)) return undefined;
    if ("failed" in answer) return "failed";
    const wall = new Map(memories.map((m) => [m.id, m]));
    const results: Results = { direct: [], related: [], mode: answer.mode };
    for (const hit of answer.hits) {
      const memory = wall.get(hit.id);
      if (memory) results[hit.match].push({ ...memory, part: hit.part });
    }
    return results;
  }, [answer, query, like, memories]);
}
