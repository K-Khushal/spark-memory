import { useEffect, useRef, useState } from "react";
import { toast } from "@spark/ui";
import { api } from "../api";

export type RecentSearch = { id: string; query: string; searchedAt: string };

/**
 * Records a committed search, or a click on one of its results, for Recent
 * searches and the product metrics. Typing is never recorded, nor a click
 * past the hundredth result; failures are silent and carry no query.
 */
export function recordSearch(
  query: string,
  click?: { memoryId: string; position: number },
  reformulation = false
) {
  if (click && (click.position < 1 || click.position > 100)) return;
  if (!query.trim() && !click) return;
  void api.api.search.events
    .$post({
      json: {
        query: query.trim().slice(0, 300),
        ...click,
        ...(reformulation && { reformulation }),
      },
    })
    .catch(() => {});
}

/** The person's Recent searches, fetched each time the menu opens, and deleting them. */
export function useRecentSearches(open: boolean) {
  const epoch = useRef(0);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const mine = ++epoch.current;
    void api.api.search.recent
      .$get()
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json();
        // A delete since this was asked for would be undone by it.
        if (active && mine === epoch.current) setRecent(body.searches);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  /** One search, or all of them. */
  const forget = async (id?: string) => {
    epoch.current++;
    try {
      const response = id
        ? await api.api.search.recent[":id"].$delete({ param: { id } })
        : await api.api.search.recent.$delete();
      if (!response.ok) throw new Error("delete failed");
      setRecent((all) => (id ? all.filter((s) => s.id !== id) : []));
    } catch {
      toast.error("Could Not Delete Search", {
        action: { label: "Try Again", onClick: () => void forget(id) },
      });
    }
  };
  return { recent, forget };
}
