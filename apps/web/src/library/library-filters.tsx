import { useMemo, type ReactNode } from "react";
import {
  CATEGORY_NAMES,
  SEARCH_KINDS,
  sourceOf,
  type SearchChips,
  type SearchColour,
  type SearchKind,
  type SearchWhen,
} from "@spark/core";
import { FilterChip, Swatch, cn } from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import type { Memory } from "./use-library";

export const KIND_LABELS: Record<SearchKind, string> = {
  image: "Images",
  pdf: "PDFs",
  video: "Videos",
  link: "Links",
  note: "Notes",
};
const WHEN_LABELS: [SearchWhen, string][] = [
  ["today", "Today"],
  ["this week", "This Week"],
  ["this month", "This Month"],
  ["this year", "This Year"],
];
/** How many of the Library's Sources the filters list. */
const SOURCES_SHOWN = 4;

const SOURCE_NAMES: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  github: "GitHub",
  linkedin: "LinkedIn",
};

/** A Source as it is named on a chip: "instagram" is Instagram, a domain stays a domain. */
export const sourceLabel = (source: string) =>
  source.includes(".")
    ? source
    : (SOURCE_NAMES[source] ?? source[0]!.toUpperCase() + source.slice(1));

/** The filter a Memory's kind belongs to; none for files, which no chip covers. */
export const kindOf = (kind: Memory["kind"]) =>
  (Object.keys(SEARCH_KINDS) as SearchKind[]).find((k) =>
    (SEARCH_KINDS[k] as readonly string[]).includes(kind)
  );

/**
 * Only what this Library has to filter by, so no chip leads nowhere. The
 * person's own Categories are always listed, even before a Memory has one:
 * they made them.
 */
export function useFilterOptions(
  memories: Memory[],
  ownCategories: readonly string[] = []
) {
  return useMemo(() => {
    const kinds = new Set<SearchKind>();
    const sources = new Map<string, number>();
    const categories = new Set<string>();
    let colours = false;
    for (const memory of memories) {
      for (const category of memory.categories) categories.add(category);
      const kind = kindOf(memory.kind);
      if (kind) kinds.add(kind);
      if (memory.image) colours = true;
      const source = memory.sourceUrl && sourceOf(memory.sourceUrl);
      if (source) sources.set(source, (sources.get(source) ?? 0) + 1);
    }
    return {
      kinds: (Object.keys(KIND_LABELS) as SearchKind[]).filter((k) =>
        kinds.has(k)
      ),
      sources: [...sources]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, SOURCES_SHOWN)
        .map(([name]) => name),
      categories: [
        ...CATEGORY_NAMES.filter((c) => categories.has(c)),
        ...ownCategories,
      ],
      colours,
    };
  }, [memories, ownCategories]);
}
export type FilterOptions = ReturnType<typeof useFilterOptions>;

/**
 * The filter chips (DESIGN.md → Pick): kinds, colours, Sources and when,
 * one choice per group, pressing a chosen one again lets go. They work
 * with an empty search box. `layout` is the sidebar's lists or the phone's
 * one scrolling row.
 */
export function LibraryFilters({
  layout,
  options,
  chips,
  onChange,
  leading,
  manage,
}: {
  leading?: ReactNode;
  layout: "sidebar" | "row";
  options: FilterOptions;
  chips: SearchChips;
  onChange: (next: SearchChips) => void;
  /** Opens the Categories dialog: the last thing in the Category group. */
  manage?: ReactNode;
}) {
  const set = <K extends keyof SearchChips>(
    group: K,
    value: SearchChips[K]
  ) => {
    const { [group]: current, ...rest } = chips;
    onChange(current === value ? rest : { ...rest, [group]: value });
  };
  const kinds = options.kinds.map((kind) => ({
    id: kind,
    label: KIND_LABELS[kind],
    on: chips.kind === kind,
    press: () => set("kind", kind),
  }));
  const categories = options.categories.map((category) => ({
    id: category,
    label: category,
    on: chips.category === category,
    press: () => set("category", category),
  }));
  const sources = options.sources.map((source) => ({
    id: source,
    // A domain reads left to right, whatever script its name is in.
    dir: "ltr" as const,
    label: sourceLabel(source),
    on: chips.source === source,
    press: () => set("source", source),
  }));
  const whens = WHEN_LABELS.map(([when, label]) => ({
    id: when,
    label,
    on: chips.when === when,
    press: () => set("when", when),
  }));
  const colours = options.colours && (
    <div
      role="group"
      aria-label="Colour"
      className={
        layout === "sidebar"
          ? "grid grid-cols-6 gap-2 px-2"
          : "flex shrink-0 items-center gap-2 px-1"
      }
    >
      {FILTER_COLOURS.map(({ name, hex }) => {
        const colour = name.toLowerCase() as SearchColour;
        return (
          <Swatch
            key={name}
            hex={hex}
            name={name}
            className={layout === "sidebar" ? "size-6" : "size-8"}
            aria-pressed={chips.colour === colour}
            onClick={() => set("colour", colour)}
          />
        );
      })}
    </div>
  );

  if (layout === "row") {
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {leading}
        {kinds.map((item) => (
          <Chip key={item.id} {...item} />
        ))}
        {colours}
        {sources.map((item) => (
          <Chip key={item.id} {...item} />
        ))}
        {whens.map((item) => (
          <Chip key={item.id} {...item} />
        ))}
        {categories.map((item) => (
          <Chip key={item.id} {...item} />
        ))}
        {manage}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {leading}
      <Group label="Kind" items={kinds} />
      {colours}
      <Group label="Source" items={sources} />
      <Group label="When" items={whens} />
      <Group label="Category" items={categories} footer={manage} />
    </div>
  );
}

function Chip({
  label,
  on,
  press,
  dir = "auto",
}: {
  dir?: "ltr" | "auto";
  label: string;
  on: boolean;
  press: () => void;
}) {
  return (
    <FilterChip aria-pressed={on} onClick={press} className="max-w-48">
      <span className="truncate" dir={dir}>
        {label}
      </span>
    </FilterChip>
  );
}

/** A sidebar group: toggles as quiet as the nav, the chosen one raised. */
function Group({
  label,
  items,
  footer,
}: {
  label: string;
  footer?: ReactNode;
  items: {
    id: string;
    dir?: "ltr" | "auto";
    label: ReactNode;
    on: boolean;
    press: () => void;
  }[];
}) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            aria-pressed={item.on}
            onClick={item.press}
            className={cn(
              "flex h-8 w-full items-center rounded-control px-2 text-left text-sm transition-[color] duration-(--duration-press) ease-out",
              item.on
                ? "bg-surface font-medium text-ink shadow-raised"
                : "text-ink-muted hover:text-ink"
            )}
          >
            <span className="truncate" dir={item.dir ?? "auto"}>
              {item.label}
            </span>
          </button>
        </li>
      ))}
      {footer && <li className="flex flex-col">{footer}</li>}
    </ul>
  );
}
