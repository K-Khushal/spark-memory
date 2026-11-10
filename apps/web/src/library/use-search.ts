import { useEffect, useMemo, useState } from "react";
import type { InferResponseType } from "@spark/api-client";
import { api } from "../api";
import type { Memory } from "./use-library";

type Hit = InferResponseType<typeof api.api.search.$get>["results"][number];

export type Results = { direct: Memory[]; related: Memory[] };

/**
 * Instant search on every keystroke (keyword and typo matching, no AI).
 * Each keystroke cancels the previous request. Hits are read through the
 * wall's own Memories, so local edits show and pending deletes stay hidden.
 * Until the Direct match judge lands (PLAN.md §6.4), a keyword match counts
 * as Direct and a typo-only match as Related.
 */
export function useInstantSearch(query: string, memories: Memory[]) {
  const [hits, setHits] = useState<{ query: string; hits: Hit[] }>();
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    api.api.search
      .$get({ query: { q } }, { init: { signal: controller.signal } })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ results }) => setHits({ query: q, hits: results }))
      .catch(() => {
        // Aborted by the next keystroke, or offline: keep the last results.
      });
    return () => controller.abort();
  }, [q]);

  return useMemo((): Results | undefined => {
    if (!q || !hits) return undefined;
    const wall = new Map(memories.map((m) => [m.id, m]));
    const results: Results = { direct: [], related: [] };
    for (const hit of hits.hits) {
      const memory = wall.get(hit.id);
      if (!memory) continue;
      (hit.matched.includes("keyword") ? results.direct : results.related).push(
        memory
      );
    }
    return results;
  }, [q, hits, memories]);
}
