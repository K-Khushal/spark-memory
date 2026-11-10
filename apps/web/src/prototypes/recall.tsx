// Prototype 3, Recall: search first. A display-size prompt, the Library as a
// timeline of shelves, and results led by one featured Direct match.
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button, Chip, cn } from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import {
  DAY_GROUPS,
  SAMPLE_SEARCHES,
  capturedLabel,
  fakeSearch,
  sourceLabel,
  type Result,
} from "./fake-library";
import {
  EmptyLibrary,
  Highlighted,
  IndexStateBadge,
  MemoryVisual,
} from "./memory-visual";
import { QuickPreview } from "./memory-details";
import {
  Arrival,
  useLibrary,
  useSearchShortcut,
  type LiveMemory,
} from "./use-library";

export function Recall() {
  const { memories, captureFromButton, retry } = useLibrary();
  const [query, setQuery] = useState("");
  const [colour, setColour] = useState<string>();
  const [preview, setPreview] = useState<Result>();
  const input = useRef<HTMLInputElement>(null);
  useSearchShortcut(useCallback(() => input.current?.focus(), []));

  const searching = query.trim() !== "" || colour !== undefined;
  const results = useMemo(
    () => (searching ? fakeSearch(memories, query, colour) : undefined),
    [memories, query, colour, searching]
  );
  const [featured, ...moreDirect] = results?.direct ?? [];

  return (
    <div className="min-h-[calc(100dvh-2.5rem)] bg-canvas pb-24">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-4 sm:px-8">
        <span className="font-display text-lg font-semibold tracking-[-0.02em]">
          Spark
        </span>
        <Button variant="outline" size="sm" onClick={captureFromButton}>
          <PlusIcon aria-hidden /> Capture
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-10 pb-8 sm:px-8 sm:pt-16">
        <label className="group flex items-end gap-3 border-b-2 border-line-strong pb-2 focus-within:border-ink">
          <span className="sr-only">Describe what you remember</span>
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
            className="w-full min-w-0 bg-transparent font-display text-lg font-semibold tracking-[-0.02em] outline-none placeholder:text-ink-muted sm:text-2xl"
          />
          {query && (
            <Button
              variant="quiet"
              size="icon"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <XIcon aria-hidden />
            </Button>
          )}
        </label>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
            {SAMPLE_SEARCHES.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                className="text-left underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
              >
                {s}
              </button>
            ))}
          </p>
          <Spectrum value={colour} onChange={setColour} />
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        {!memories.length && !searching ? (
          <EmptyLibrary onCapture={captureFromButton} />
        ) : !results ? (
          DAY_GROUPS.map((g) => {
            const items = memories.filter(
              (x) => x.daysAgo >= g.from && x.daysAgo <= g.to
            );
            return items.length ? (
              <Shelf
                key={g.label}
                title={g.label}
                items={items.map((memory) => ({ memory, why: [] }))}
                onOpen={setPreview}
                onRetry={retry}
              />
            ) : null;
          })
        ) : (
          <>
            {featured ? (
              <section aria-labelledby="direct" className="mb-12">
                <h2
                  id="direct"
                  className="mb-4 text-sm font-medium text-ink-muted"
                >
                  {results.direct.length === 1
                    ? "Direct match"
                    : `Direct matches, ${results.direct.length}`}
                </h2>
                <button
                  type="button"
                  onClick={() => setPreview(featured)}
                  className="grid w-full gap-6 rounded-panel text-left md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
                >
                  <div
                    className="overflow-hidden rounded-panel"
                    style={{ aspectRatio: Math.max(featured.memory.aspect, 1) }}
                  >
                    <MemoryVisual memory={featured.memory} query={query} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-3 md:py-4">
                    <p className="text-sm text-ink-muted">
                      {sourceLabel(featured.memory)},{" "}
                      {capturedLabel(featured.memory.daysAgo).toLowerCase()}
                    </p>
                    <h3
                      className="font-display text-xl leading-tight font-semibold tracking-[-0.02em] break-words sm:text-2xl"
                      dir="auto"
                    >
                      <Highlighted text={featured.memory.title} query={query} />
                    </h3>
                    {(featured.memory.excerpt ||
                      featured.memory.captureNote) && (
                      <p
                        className="max-w-[60ch] text-md text-ink-muted"
                        dir="auto"
                      >
                        <Highlighted
                          text={
                            featured.memory.excerpt ??
                            `“${featured.memory.captureNote}”`
                          }
                          query={query}
                        />
                      </p>
                    )}
                    <ul
                      className="flex flex-wrap gap-1.5"
                      aria-label="Why it matched"
                    >
                      {featured.why.map((w, i) => (
                        <li key={w}>
                          <Chip tone={i === 0 ? "spark" : "why"}>
                            <span>{w}</span>
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  </div>
                </button>
                {moreDirect.length > 0 && (
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {moreDirect.map((r) => (
                      <li key={r.memory.id}>
                        <button
                          type="button"
                          onClick={() => setPreview(r)}
                          className="flex w-full gap-3 rounded-tile p-1 text-left hover:bg-sunken"
                        >
                          <span className="size-20 shrink-0 overflow-hidden rounded-control">
                            <MemoryVisual
                              memory={r.memory}
                              className="[&_p]:text-xs"
                            />
                          </span>
                          <span className="min-w-0 py-1">
                            <span
                              className="line-clamp-2 font-medium break-words"
                              dir="auto"
                            >
                              {r.memory.title}
                            </span>
                            <span className="mt-1 flex gap-1">
                              {r.why.slice(0, 2).map((w) => (
                                <Chip key={w}>
                                  <span>{w}</span>
                                </Chip>
                              ))}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <section className="mb-10 max-w-2xl">
                <h2 className="font-display text-xl leading-tight font-semibold tracking-[-0.02em] sm:text-2xl">
                  Nothing matches {query ? `“${query}”` : "that"} closely.
                </h2>
                <p className="mt-2 text-md text-ink-muted">
                  {results.related.length
                    ? "Here is what comes closest."
                    : "Try what it showed, a colour, or where you saw it."}
                </p>
              </section>
            )}
            {results.related.length > 0 && (
              <Shelf
                title="Related matches"
                note="Similar, not a confident match."
                items={results.related}
                query={query}
                small
                onOpen={setPreview}
                onRetry={retry}
              />
            )}
          </>
        )}
      </main>

      <QuickPreview
        memory={preview?.memory}
        why={preview?.why}
        query={query}
        onClose={() => setPreview(undefined)}
      />
    </div>
  );
}

/** Colour filter as one continuous strip: a spectrum, not a row of dots. */
function Spectrum({
  value,
  onChange,
}: {
  value?: string;
  onChange: (c?: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Colour"
      className="flex h-8 w-full shrink-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_15%,transparent)] sm:w-80"
    >
      {FILTER_COLOURS.map((c) => (
        <button
          key={c.name}
          type="button"
          aria-label={c.name}
          title={c.name}
          aria-pressed={value === c.name}
          onClick={() => onChange(value === c.name ? undefined : c.name)}
          className={cn(
            "relative flex-1 transition-[flex-grow] duration-[180ms] ease-out focus-visible:z-10 focus-visible:outline-offset-[-3px]",
            value === c.name &&
              "flex-[2.5] after:absolute after:inset-x-0 after:bottom-1 after:mx-auto after:size-1.5 after:rounded-full after:bg-[#fff] after:shadow-raised after:content-['']"
          )}
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
}

function Shelf({
  title,
  note,
  items,
  query = "",
  small = false,
  onOpen,
  onRetry,
}: {
  title: string;
  note?: string;
  items: (Result & { memory: LiveMemory })[];
  query?: string;
  small?: boolean;
  onOpen: (r: Result) => void;
  onRetry: (id: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const height = small ? 140 : 200;

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      const next = Math.min(items.length - 1, Math.max(0, active + step));
      setActive(next);
      list.current?.querySelectorAll<HTMLElement>("[data-tile]")[next]?.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Move to the neighbouring shelf.
      const shelves = [
        ...document.querySelectorAll<HTMLElement>("[data-shelf]"),
      ];
      const here = shelves.indexOf(list.current!);
      const target = shelves[here + (event.key === "ArrowDown" ? 1 : -1)];
      const tile = target?.querySelector<HTMLElement>(
        "[data-tile][tabindex='0']"
      );
      if (tile) {
        event.preventDefault();
        tile.focus();
      }
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (items[active]) onOpen(items[active]);
    }
  };

  return (
    <section className="mb-10">
      <h2 className="flex items-baseline gap-2 font-display text-lg font-semibold tracking-[-0.01em]">
        {title}
        <span className="font-sans text-sm font-normal text-ink-muted tabular">
          {items.length}
        </span>
      </h2>
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      <ul
        ref={list}
        data-shelf
        aria-label={title}
        onKeyDown={onKeyDown}
        className="-mx-4 mt-3 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:-mx-8 sm:scroll-px-8 sm:px-8"
      >
        {items.map((r, i) => (
          <li
            key={r.memory.id}
            data-tile
            tabIndex={i === active ? 0 : -1}
            aria-label={r.memory.title}
            onFocus={() => setActive(i)}
            onClick={() => onOpen(r)}
            className="group shrink-0 cursor-pointer snap-start rounded-tile outline-offset-2"
            style={{
              width: Math.round(
                height * Math.min(Math.max(r.memory.aspect, 0.66), 1.8)
              ),
            }}
          >
            <div
              className="relative overflow-hidden rounded-tile transition-transform duration-[120ms] ease-out group-active:scale-[0.98]"
              style={{ height }}
            >
              <Arrival fresh={r.memory.fresh}>
                <MemoryVisual
                  memory={r.memory}
                  query={query}
                  className={small ? "[&_p]:text-xs" : undefined}
                />
              </Arrival>
              <IndexStateBadge
                memory={r.memory}
                onRetry={() => onRetry(r.memory.id)}
                className="absolute right-2 bottom-2"
              />
            </div>
            <p className="mt-2 truncate text-sm font-medium" dir="auto">
              {r.memory.title}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {r.why[0] ?? sourceLabel(r.memory)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
