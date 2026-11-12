import { api } from "../api";
export type RecentSearch = { id: string; query: string; searchedAt: string };
/** Committed searches and clicks only; errors never include the query. */
export function recordSearch(
  query: string,
  click?: { memoryId: string; position: number },
  reformulation = false
) {
  if (!query.trim() && !click) return;
  void api.api.search.events
    .$post({ json: { query: query.slice(0, 500), ...click, reformulation } })
    .catch(() => {});
}
