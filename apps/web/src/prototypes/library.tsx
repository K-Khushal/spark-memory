// Reference only: the chosen design direction (DESIGN.md → Pick), built on
// fake data. The real Library screen will be built from this, then
// apps/web/src/prototypes/ goes. Files: library.tsx (this screen), tile.tsx,
// memory-visual.tsx, quick-preview.tsx, use-library.tsx, fake-library.ts.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { MoonIcon, PlusIcon, SearchIcon, SunIcon, XIcon } from "lucide-react";
import {
  Button,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  FilterChip,
  Kbd,
  Masonry,
  Swatch,
  Toaster,
  cn,
} from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import type { MemoryKind } from "@spark/core";
import {
  CATEGORIES,
  KIND_LABELS,
  fakeSearch,
  type Result,
} from "./fake-library";
import { EmptyLibrary, MemoryVisual } from "./memory-visual";
import { QuickPreview } from "./quick-preview";
import { Tile, captionHeight } from "./tile";
import {
  DATA_SETS,
  useLibrary,
  useSearchShortcut,
  type DataSet,
  type LiveMemory,
} from "./use-library";

type Filter = { kind?: MemoryKind; category?: string; colour?: string };

export function LibraryPage({ data }: { data: DataSet }) {
  const { memories, captureFromButton, retry } = useLibrary(data);
  const [filter, setFilter] = useState<Filter>({});
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [preview, setPreview] = useState<Result>();

  const openSearch = useCallback(() => {
    setDraft(query);
    setSearchOpen(true);
  }, [query]);
  useSearchShortcut(openSearch);

  const shown = useMemo(
    () =>
      memories.filter(
        (x) =>
          (!filter.kind || x.kind === filter.kind) &&
          (!filter.category || x.categories.includes(filter.category))
      ),
    [memories, filter.kind, filter.category]
  );
  const searching = query.trim() !== "" || filter.colour !== undefined;
  const results = useMemo(
    () => (searching ? fakeSearch(shown, query, filter.colour) : undefined),
    [searching, shown, query, filter.colour]
  );
  const instant = useMemo(
    () => (draft.trim() ? fakeSearch(memories, draft) : undefined),
    [memories, draft]
  );

  const toggle = (next: Filter) =>
    setFilter((f) => {
      const [key, value] = Object.entries(next)[0] as [keyof Filter, string];
      return { ...f, [key]: f[key] === value ? undefined : value };
    });
  const run = (q: string) => {
    setQuery(q);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };
  const pick = (r: Result) => {
    setSearchOpen(false);
    setPreview(r);
  };

  const searchButton = (
    <button
      type="button"
      onClick={openSearch}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-control bg-surface px-2.5 text-left text-sm text-ink-muted shadow-raised transition-transform duration-[120ms] ease-out active:scale-[0.99]"
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate", query && "text-ink")}>
        {query || "Search"}
      </span>
      {!query && <Kbd className="hidden md:inline-flex">⌘K</Kbd>}
    </button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh bg-canvas">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-sunken p-3 md:flex">
          <div className="flex h-8 items-center justify-between pl-2">
            <span className="font-display text-md font-semibold">Spark</span>
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label="Capture"
              onClick={captureFromButton}
            >
              <PlusIcon aria-hidden />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {searchButton}
            {query && <ClearSearch onClear={() => setQuery("")} />}
          </div>
          <nav aria-label="Library" className="flex flex-col gap-5">
            <ul>
              <NavItem
                active={!filter.kind && !filter.category}
                onClick={() => setFilter((f) => ({ colour: f.colour }))}
              >
                All Memories
              </NavItem>
              {KIND_LABELS.map(([kind, label]) => (
                <NavItem
                  key={kind}
                  active={filter.kind === kind}
                  onClick={() => toggle({ kind })}
                >
                  {label}
                </NavItem>
              ))}
            </ul>
            <Colours
              value={filter.colour}
              onPick={(colour) => toggle({ colour })}
              className="grid grid-cols-6 gap-2 px-2"
            />
            <ul aria-label="Categories">
              {CATEGORIES.map((category) => (
                <NavItem
                  key={category}
                  active={filter.category === category}
                  onClick={() => toggle({ category })}
                >
                  {category}
                </NavItem>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-20 border-b border-line bg-canvas md:hidden">
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="font-display text-md font-semibold">Spark</span>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {searchButton}
                {query && <ClearSearch onClear={() => setQuery("")} />}
              </div>
              <Button
                variant="primary"
                size="icon"
                aria-label="Capture"
                onClick={captureFromButton}
              >
                <PlusIcon aria-hidden />
              </Button>
            </div>
            {memories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
                {KIND_LABELS.map(([kind, label]) => (
                  <FilterChip
                    key={kind}
                    aria-pressed={filter.kind === kind}
                    onClick={() => toggle({ kind })}
                  >
                    {label}
                  </FilterChip>
                ))}
                <Colours
                  value={filter.colour}
                  onPick={(colour) => toggle({ colour })}
                  className="flex shrink-0 gap-1.5 pl-1"
                />
              </div>
            )}
          </div>

          <div className="p-4 md:p-6">
            {!memories.length ? (
              <EmptyLibrary onCapture={captureFromButton} />
            ) : !results ? (
              <Wall
                label="Library"
                items={shown.map((memory) => ({ memory, why: [] }))}
                query=""
                onOpen={setPreview}
                onRetry={retry}
              />
            ) : (
              <>
                <Section
                  title={
                    results.direct.length
                      ? "Direct Matches"
                      : "No Direct Matches"
                  }
                >
                  {results.direct.length > 0 && (
                    <Wall
                      label="Direct Matches"
                      items={results.direct}
                      query={query}
                      direct
                      onOpen={setPreview}
                      onRetry={retry}
                    />
                  )}
                </Section>
                {results.related.length > 0 && (
                  <Section title="Related Matches" className="mt-10">
                    <Wall
                      label="Related Matches"
                      items={results.related}
                      query={query}
                      onOpen={setPreview}
                      onRetry={retry}
                    />
                  </Section>
                )}
              </>
            )}
          </div>
        </main>

        <CommandDialog
          title="Search"
          open={searchOpen}
          onOpenChange={setSearchOpen}
          shouldFilter={false}
        >
          <CommandInput
            value={draft}
            onValueChange={setDraft}
            placeholder="Search…"
            className="text-[1rem] md:text-md"
          />
          {instant && (
            <CommandList>
              <CommandItem value="__search" onSelect={() => run(draft)}>
                <SearchIcon className="size-4 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{draft}</span>
                <Kbd>↵</Kbd>
              </CommandItem>
              {instant.direct.length > 0 && (
                <CommandGroup heading="Direct Matches">
                  {instant.direct.slice(0, 5).map((r) => (
                    <SearchRow
                      key={r.memory.id}
                      result={r}
                      onSelect={() => pick(r)}
                    />
                  ))}
                </CommandGroup>
              )}
              {instant.related.length > 0 && (
                <CommandGroup heading="Related Matches">
                  {instant.related.slice(0, 4).map((r) => (
                    <SearchRow
                      key={r.memory.id}
                      result={r}
                      onSelect={() => pick(r)}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          )}
        </CommandDialog>

        <QuickPreview
          result={preview}
          query={query}
          onClose={() => setPreview(undefined)}
        />
        <DevBar data={data} />
        <Toaster />
      </div>
    </MotionConfig>
  );
}

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h2 className="mb-3 text-sm font-medium text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

function Wall({
  label,
  items,
  query,
  direct = false,
  onOpen,
  onRetry,
}: {
  label: string;
  items: (Result & { memory: LiveMemory })[];
  query: string;
  direct?: boolean;
  onOpen: (r: Result) => void;
  onRetry: (id: string) => void;
}) {
  const withWhy = query !== "" || items.some((r) => r.why.length > 0);
  return (
    <Masonry
      label={label}
      items={items}
      getKey={(r) => r.memory.id}
      getAspect={(r) => r.memory.aspect}
      getLabel={(r) => r.memory.title}
      getCaption={(r) => captionHeight(r, withWhy)}
      minColumnWidth={direct ? 260 : 200}
      maxColumns={direct ? 5 : 7}
      gap={direct ? 16 : 12}
      onOpen={(i) => items[i] && onOpen(items[i])}
      onPreview={(i) => items[i] && onOpen(items[i])}
      renderItem={(r, tile) => (
        <Tile
          result={r}
          height={tile.height}
          query={query}
          withWhy={withWhy}
          direct={direct}
          onRetry={onRetry}
        />
      )}
    />
  );
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "flex h-8 w-full items-center rounded-control px-2 text-left text-sm text-ink-muted transition-colors duration-[120ms] hover:text-ink",
          active && "bg-surface font-medium text-ink shadow-raised"
        )}
      >
        <span className="truncate">{children}</span>
      </button>
    </li>
  );
}

function Colours({
  value,
  onPick,
  className,
}: {
  value?: string;
  onPick: (colour: string) => void;
  className: string;
}) {
  return (
    <div role="group" aria-label="Colour" className={className}>
      {FILTER_COLOURS.map((c) => (
        <Swatch
          key={c.name}
          hex={c.hex}
          name={c.name}
          className="size-6"
          aria-pressed={value === c.name}
          onClick={() => onPick(c.name)}
        />
      ))}
    </div>
  );
}

function ClearSearch({ onClear }: { onClear: () => void }) {
  return (
    <Button
      variant="quiet"
      size="icon-sm"
      aria-label="Clear Search"
      onClick={onClear}
    >
      <XIcon aria-hidden />
    </Button>
  );
}

function SearchRow({
  result,
  onSelect,
}: {
  result: Result;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={result.memory.id} onSelect={onSelect}>
      <span className="size-9 shrink-0 overflow-hidden rounded-chip">
        <MemoryVisual memory={result.memory} className="[&_p]:hidden" />
      </span>
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {result.memory.title}
      </span>
    </CommandItem>
  );
}

const DATA_LABELS: Record<DataSet, string> = {
  library: "Worst Case",
  empty: "Empty",
  huge: "1,000",
};

/** Dev-only: the break-ui data states and the theme. */
function DevBar({ data }: { data: DataSet }) {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark"
  );
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("spark-theme", next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setDark(!dark);
  };
  return (
    <div className="fixed right-3 bottom-3 z-40 hidden items-center gap-0.5 rounded-control bg-surface p-0.5 text-xs shadow-raised md:flex">
      {DATA_SETS.map((d) => (
        <Link
          key={d}
          to="/prototypes"
          search={{ data: d }}
          aria-current={d === data ? "true" : undefined}
          className={cn(
            "rounded-chip px-2 py-1 text-ink-muted hover:text-ink",
            d === data && "bg-sunken text-ink"
          )}
        >
          {DATA_LABELS[d]}
        </Link>
      ))}
      <button
        type="button"
        onClick={flip}
        aria-label={dark ? "Light Theme" : "Dark Theme"}
        className="grid size-6 place-items-center rounded-chip text-ink-muted hover:text-ink"
      >
        {dark ? (
          <SunIcon className="size-3.5" aria-hidden />
        ) : (
          <MoonIcon className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
