import type { ProductEvent } from "@spark/core";

/**
 * Search metrics for one visit. The query stays here so a product event can
 * say that the person reformulated, without the words they typed.
 */
export function productMetrics(
  track: (event: ProductEvent) => void,
  now: () => number = Date.now
) {
  let committed = "";
  let startedAt: number | undefined;
  let looking = false;

  return {
    searchOpened() {
      looking = true;
      if (startedAt === undefined) startedAt = now();
    },
    committedSearch(
      query: string,
      counts: { direct: number; related: number }
    ) {
      const trimmed = query.trim();
      if (!trimmed) return;
      looking = true;
      if (startedAt === undefined) startedAt = now();
      if (committed && committed !== trimmed) {
        track({ event: "search_reformulated", properties: {} });
      }
      committed = trimmed;
      if (counts.direct + counts.related > 0) {
        track({ event: "search_success", properties: counts });
      }
    },
    found() {
      if (!looking || startedAt === undefined) return;
      track({
        event: "time_to_find",
        properties: { milliseconds: Math.max(0, now() - startedAt) },
      });
      startedAt = undefined;
      looking = false;
    },
    /** The search menu closed with nothing committed: opening a tile is not a find. */
    abandoned() {
      if (committed) return;
      looking = false;
      startedAt = undefined;
    },
    cleared() {
      committed = "";
      looking = false;
      startedAt = undefined;
    },
  };
}
