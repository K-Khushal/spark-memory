// Prototype 2, Desk: a three-pane tool. Filters on the left, Google-Images
// justified rows in the middle, details on the right. Dense and keyboard-led.
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Button, Chip, FilterChip, Kbd, Swatch, cn } from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import { justifyRows } from "@spark/ui/layout";
import {
  CATEGORIES,
  LOOK_LABEL,
  SAMPLE_SEARCHES,
  fakeSearch,
  showsTitle,
  sourceLabel,
  type Look,
  type Result,
} from "./fake-library";
import { EmptyLibrary, IndexStateBadge, MemoryVisual } from "./memory-visual";
import { MemoryDetails, QuickPreview } from "./memory-details";
import {
  Arrival,
  useLibrary,
  useSearchShortcut,
  type LiveMemory,
} from "./use-library";

const CAPTION = 40;

export function Desk() {
  const { memories, captureFromButton, retry } = useLibrary();
  const [query, setQuery] = useState("");
  const [colour, setColour] = useState<string>();
  const [look, setLook] = useState<Look>();
  const [category, setCategory] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<Result>();
  const input = useRef<HTMLInputElement>(null);
  useSearchShortcut(useCallback(() => input.current?.focus(), []));

  const filtered = useMemo(
    () =>
      memories.filter(
        (x) =>
          (!look || x.look === look) &&
          (!category || x.categories.includes(category))
      ),
    [memories, look, category]
  );
  const searching = query.trim() !== "" || colour !== undefined;
  const results = useMemo(
    () =>
      searching
        ? fakeSearch(filtered, query, colour)
        : {
            direct: filtered.map((memory) => ({ memory, why: [] })),
            related: [],
          },
    [filtered, query, colour, searching]
  );
  const flat = [...results.direct, ...results.related];
  const current = flat.find((r) => r.memory.id === selected);
  const count = (pred: (x: LiveMemory) => boolean) =>
    memories.filter(pred).length;

  const rail = (
    <>
      <RailGroup label="Kind">
        {(Object.keys(LOOK_LABEL) as Look[]).map((l) => (
          <RailItem
            key={l}
            active={look === l}
            count={count((x) => x.look === l)}
            onClick={() => setLook(look === l ? undefined : l)}
          >
            {LOOK_LABEL[l]}
          </RailItem>
        ))}
      </RailGroup>
      <RailGroup label="Categories">
        {CATEGORIES.map((c) => (
          <RailItem
            key={c}
            active={category === c}
            count={count((x) => x.categories.includes(c))}
            onClick={() => setCategory(category === c ? undefined : c)}
          >
            {c}
          </RailItem>
        ))}
      </RailGroup>
    </>
  );

  return (
    <div className="flex min-h-[calc(100dvh-2.5rem)] bg-canvas">
      <aside className="sticky top-0 hidden h-[calc(100dvh-2.5rem)] w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line px-3 py-4 lg:flex">
        <div className="flex items-center justify-between px-2">
          <span className="font-display text-lg font-semibold tracking-[-0.02em]">
            Spark
          </span>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Capture"
            onClick={captureFromButton}
          >
            <PlusIcon aria-hidden />
          </Button>
        </div>
        <RailItem
          active={!look && !category}
          count={memories.length}
          onClick={() => {
            setLook(undefined);
            setCategory(undefined);
          }}
        >
          Library
        </RailItem>
        {rail}
        <RailGroup label="Colour">
          <div className="grid grid-cols-6 gap-2 px-2 pt-1">
            {FILTER_COLOURS.map((c) => (
              <Swatch
                key={c.name}
                hex={c.hex}
                name={c.name}
                className="size-6"
                aria-pressed={colour === c.name}
                onClick={() =>
                  setColour(colour === c.name ? undefined : c.name)
                }
              />
            ))}
          </div>
        </RailGroup>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur-md [@media(prefers-reduced-transparency:reduce)]:bg-canvas">
          <div className="flex items-center gap-2">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 focus-within:border-ink">
              <SearchIcon
                className="size-4 shrink-0 text-ink-muted"
                aria-hidden
              />
              <span className="sr-only">Search your Library</span>
              <input
                ref={input}
                type="search"
                name="q"
                autoComplete="off"
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder="Describe what you remember…"
                className="h-full min-w-0 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-ink-muted sm:text-base"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="grid size-6 place-items-center rounded-chip text-ink-muted hover:bg-sunken"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              ) : (
                <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
              )}
            </label>
            <Button
              variant="primary"
              className="lg:hidden"
              onClick={captureFromButton}
              aria-label="Capture"
            >
              <PlusIcon aria-hidden />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] lg:hidden">
            {FILTER_COLOURS.slice(0, 8).map((c) => (
              <Swatch
                key={c.name}
                hex={c.hex}
                name={c.name}
                className="size-6"
                aria-pressed={colour === c.name}
                onClick={() =>
                  setColour(colour === c.name ? undefined : c.name)
                }
              />
            ))}
            {(Object.keys(LOOK_LABEL) as Look[]).map((l) => (
              <FilterChip
                key={l}
                aria-pressed={look === l}
                className="h-7"
                onClick={() => setLook(look === l ? undefined : l)}
              >
                {LOOK_LABEL[l]}
              </FilterChip>
            ))}
          </div>
          {!query && (
            <p className="mt-2 hidden truncate text-xs text-ink-muted sm:block">
              Try{" "}
              {SAMPLE_SEARCHES.slice(0, 3).map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <button
                    type="button"
                    className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                    onClick={() => setQuery(s)}
                  >
                    {s}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="px-4 py-4">
          {searching && (
            <h2 className="mb-2 flex items-baseline gap-2 text-sm font-medium text-ink">
              {results.direct.length
                ? "Direct matches"
                : `No Direct match for “${query || colour}”`}
              <span className="text-ink-muted tabular">
                {results.direct.length || ""}
              </span>
            </h2>
          )}
          {!memories.length && !searching && (
            <EmptyLibrary onCapture={captureFromButton} />
          )}
          {!searching && memories.length > 0 && (
            <p className="mb-2 text-sm text-ink-muted tabular">
              {results.direct.length}{" "}
              {results.direct.length === 1 ? "Memory" : "Memories"}
            </p>
          )}
          <Rows
            items={results.direct}
            offset={0}
            target={searching ? 240 : 200}
            selected={selected}
            onSelect={setSelected}
            onPreview={setPreview}
            query={query}
            onRetry={retry}
          />
          {results.related.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-medium text-ink">
                Related matches{" "}
                <span className="text-ink-muted tabular">
                  {results.related.length}
                </span>
              </h2>
              <p className="mb-2 text-xs text-ink-muted">
                Similar, not a confident match.
              </p>
              <Rows
                items={results.related}
                offset={results.direct.length}
                target={140}
                selected={selected}
                onSelect={setSelected}
                onPreview={setPreview}
                query={query}
                onRetry={retry}
              />
            </section>
          )}
          {searching && !flat.length && (
            <p className="py-16 text-center text-ink-muted">
              Nothing in your Library looks like that. Try a colour or what it
              showed.
            </p>
          )}
        </div>
      </main>

      <aside
        aria-label="Details"
        className="sticky top-0 hidden h-[calc(100dvh-2.5rem)] w-[22rem] shrink-0 overflow-y-auto border-l border-line bg-surface xl:block"
      >
        {current ? (
          <div className="flex flex-col gap-4 p-4">
            <div
              className="overflow-hidden rounded-tile"
              style={{ aspectRatio: Math.max(current.memory.aspect, 0.75) }}
            >
              <MemoryVisual memory={current.memory} query={query} />
            </div>
            <h2
              className="font-display text-lg leading-snug font-semibold break-words"
              dir="auto"
            >
              {current.memory.title}
            </h2>
            <MemoryDetails
              memory={current.memory}
              why={current.why}
              query={query}
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-muted">
            <p>
              Select a Memory to see where it came from and why it matched.{" "}
              <Kbd>Space</Kbd> opens a large preview.
            </p>
          </div>
        )}
      </aside>

      <QuickPreview
        memory={preview?.memory}
        why={preview?.why}
        query={query}
        onClose={() => setPreview(undefined)}
      />
    </div>
  );
}

function RailGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <h3 className="px-2 pb-1 text-xs font-medium text-ink-muted">{label}</h3>
      {children}
    </div>
  );
}

function RailItem({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-between rounded-control px-2 text-left text-sm text-ink transition-colors duration-[120ms] hover:bg-sunken",
        active && "bg-sunken font-medium"
      )}
    >
      <span className="truncate">{children}</span>
      <span className="text-xs text-ink-muted tabular">{count}</span>
    </button>
  );
}

function Rows({
  items,
  offset,
  target,
  selected,
  query,
  onSelect,
  onPreview,
  onRetry,
}: {
  items: (Result & { memory: LiveMemory })[];
  offset: number;
  target: number;
  selected?: string;
  query: string;
  onSelect: (id: string) => void;
  onPreview: (r: Result) => void;
  onRetry: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const narrow = width < 600;
  const rows = useMemo(
    () =>
      width
        ? justifyRows(
            items.map((r) =>
              Math.max(
                r.memory.aspect,
                showsTitle(r.memory) ? (narrow ? 1.2 : 0.8) : 0.6
              )
            ),
            { width, targetHeight: narrow ? target * 0.62 : target, gap: 8 }
          )
        : [],
    [items, width, target, narrow]
  );

  const move = (event: KeyboardEvent, row: number, col: number) => {
    const at = (r: number) => {
      const line = rows[r];
      if (!line) return undefined;
      // Nearest item by horizontal centre in the target row.
      const x =
        rows[row]!.items.slice(0, col).reduce((s, i) => s + i.width + 8, 0) +
        rows[row]!.items[col]!.width / 2;
      let acc = 0;
      for (const item of line.items) {
        if (x <= acc + item.width + 8) return item.index;
        acc += item.width + 8;
      }
      return line.items.at(-1)!.index;
    };
    const here = rows[row]!.items[col]!.index;
    const next = {
      ArrowLeft: here - 1,
      ArrowRight: here + 1,
      ArrowUp: at(row - 1),
      ArrowDown: at(row + 1),
    }[event.key];
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (items[here]) onPreview(items[here]);
      return;
    }
    if (next === undefined || !items[next]) return;
    event.preventDefault();
    onSelect(items[next].memory.id);
    ref.current
      ?.querySelector<HTMLElement>(`[data-memory="${items[next].memory.id}"]`)
      ?.focus();
  };

  return (
    <div ref={ref} role="list" className="flex flex-col gap-2">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-2">
          {row.items.map((item, c) => {
            const result = items[item.index]!;
            const m = result.memory;
            const isSelected = selected === m.id;
            const tabbable = selected ? isSelected : item.index === 0;
            return (
              <div
                key={m.id}
                role="listitem"
                data-memory={m.id}
                tabIndex={tabbable ? 0 : -1}
                aria-label={m.title}
                aria-current={isSelected || undefined}
                onFocus={() => onSelect(m.id)}
                onClick={() =>
                  // No details pane below xl: open the preview instead.
                  window.innerWidth < 1280 ? onPreview(result) : onSelect(m.id)
                }
                onDoubleClick={() => onPreview(result)}
                onKeyDown={(e) => move(e, r, c)}
                className="group shrink-0 cursor-default rounded-control outline-offset-2"
                style={{ width: item.width }}
              >
                <div
                  className={cn(
                    "relative overflow-hidden rounded-control ring-offset-2 ring-offset-canvas transition-shadow duration-[120ms]",
                    isSelected && "ring-2 ring-ink"
                  )}
                  style={{ height: row.height }}
                >
                  <Arrival fresh={m.fresh}>
                    <MemoryVisual
                      memory={m}
                      query={query}
                      className="[&_p]:text-xs"
                    />
                  </Arrival>
                  <IndexStateBadge
                    memory={m}
                    onRetry={() => onRetry(m.id)}
                    className="absolute right-1.5 bottom-1.5"
                  />
                </div>
                <div
                  className="flex h-10 min-w-0 flex-col justify-center"
                  style={{ height: CAPTION }}
                >
                  {result.why[0] ? (
                    <Chip
                      className="h-5 self-start px-1.5 text-2xs"
                      tone={offset === 0 ? "spark" : "why"}
                    >
                      <span>{result.why[0]}</span>
                    </Chip>
                  ) : (
                    <span className="truncate text-xs text-ink-muted">
                      {sourceLabel(m)}
                    </span>
                  )}
                  <span className="truncate text-xs text-ink" dir="auto">
                    {m.title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
