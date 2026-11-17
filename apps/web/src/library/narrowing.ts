import { CATEGORY_NAMES, type SearchChips, type SearchKind } from "@spark/core";
import { KIND_LABELS, kindOf } from "./library-filters";
import type { Memory } from "./use-library";

/** A chip's name with case and a plural "s" set aside. */
const stem = (name: string) => name.toLowerCase().replace(/s$/, "");

/**
 * The chips that narrow a set of Related Matches: the kinds and Categories
 * some of them have. One that all of them have narrows nothing, one already
 * chosen is on, and "Other" says nothing, so none of those is offered.
 */
export function narrowing(
  found: readonly Pick<Memory, "kind" | "categories">[],
  chosen: SearchChips
) {
  const kinds = new Map<SearchKind, number>();
  const categories = new Map<string, number>();
  for (const memory of found) {
    const kind = kindOf(memory.kind);
    if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    for (const category of memory.categories)
      categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const some = (count: number | undefined) =>
    count !== undefined && count < found.length;
  const offered = (Object.keys(KIND_LABELS) as SearchKind[]).filter(
    (k) => some(kinds.get(k)) && chosen.kind !== k
  );
  // "Video" beside "Videos" is one choice said twice.
  const said = new Set(offered.map((k) => stem(KIND_LABELS[k])));
  return {
    kinds: offered,
    // The built-ins in their order, then the person's own as they were found.
    categories: [
      ...CATEGORY_NAMES,
      ...[...categories.keys()].filter(
        (c) => !(CATEGORY_NAMES as readonly string[]).includes(c)
      ),
    ].filter(
      (c) =>
        c !== "Other" &&
        some(categories.get(c)) &&
        chosen.category !== c &&
        !said.has(stem(c))
    ),
  };
}
