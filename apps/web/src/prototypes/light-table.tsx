// Prototype 1, Light table: the Memories are the interface. A full-bleed
// virtualised masonry wall; chrome collapses to one floating search bar.
import { useCallback, useMemo, useState } from "react";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  Button,
  Chip,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  FilterChip,
  Kbd,
  Masonry,
  Swatch,
  cn,
} from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import {
  SAMPLE_SEARCHES,
  capturedLabel,
  fakeSearch,
  showsTitle,
  sourceLabel,
  type Look,
  type Result,
} from "./fake-library";
import { EmptyLibrary, IndexStateBadge, MemoryVisual } from "./memory-visual";
import { QuickPreview } from "./memory-details";
import {
  Arrival,
  useLibrary,
  useSearchShortcut,
  type LiveMemory,
} from "./use-library";

const KINDS: { look: Look | "all"; label: string }[] = [
  { look: "all", label: "Everything" },
  { look: "photo", label: "Images" },
  { look: "screenshot", label: "Screenshots" },
  { look: "article", label: "Articles" },
  { look: "video", label: "Videos" },
  { look: "pdf", label: "PDFs" },
  { look: "post", label: "Posts" },
  { look: "text", label: "Text" },
];

export function LightTable() {
  const { memories, captureFromButton, retry } = useLibrary();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [palette, setPalette] = useState(false);
  const [colour, setColour] = useState<string>();
  const [kind, setKind] = useState<Look | "all">("all");
  const [preview, setPreview] = useState<Result>();

  const openPalette = useCallback(() => {
    setDraft(query);
    setPalette(true);
  }, [query]);
  useSearchShortcut(openPalette);

  const visible = useMemo(
    () => memories.filter((x) => kind === "all" || x.look === kind),
    [memories, kind]
  );
  const searching = query.trim() !== "" || colour !== undefined;
  const results = useMemo(
    () => (searching ? fakeSearch(visible, query, colour) : undefined),
    [visible, query, colour, searching]
  );
  const instant = useMemo(
    () => (draft.trim() ? fakeSearch(memories, draft) : undefined),
    [memories, draft]
  );

  const run = (q: string) => {
    setQuery(q);
    setPalette(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-dvh bg-canvas pb-28 sm:pb-16">
      <header className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 sm:px-6">
        <span className="font-display text-lg font-semibold tracking-[-0.02em]">
          Spark
        </span>
        <button
          type="button"
          onClick={openPalette}
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex h-12 max-w-xl items-center gap-3 rounded-full bg-surface/85 px-4 text-left text-ink-muted shadow-overlay ring-1 ring-line backdrop-blur-xl transition-transform duration-[120ms] ease-out active:scale-[0.99] sm:static sm:h-11 sm:flex-1 sm:shadow-raised [@media(prefers-reduced-transparency:reduce)]:bg-surface"
        >
          <SearchIcon className="size-5 shrink-0" aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", query && "text-ink")}>
            {query || "Search your Library…"}
          </span>
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>
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
        <Button
          variant="primary"
          className="ml-auto sm:ml-0"
          onClick={captureFromButton}
        >
          <PlusIcon aria-hidden /> Capture
          <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
            ⌘V
          </Kbd>
        </Button>
      </header>

      <div className="flex items-center gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-6">
        <div className="flex gap-1.5" role="group" aria-label="Kind">
          {KINDS.map((k) => (
            <FilterChip
              key={k.look}
              aria-pressed={kind === k.look}
              onClick={() => setKind(k.look)}
            >
              {k.label}
            </FilterChip>
          ))}
        </div>
        <div
          className="flex shrink-0 gap-1.5 pr-4"
          role="group"
          aria-label="Colour"
        >
          {FILTER_COLOURS.map((c) => (
            <Swatch
              key={c.name}
              hex={c.hex}
              name={c.name}
              aria-pressed={colour === c.name}
              onClick={() => setColour(colour === c.name ? undefined : c.name)}
            />
          ))}
        </div>
      </div>

      <main className="px-4 sm:px-6">
        {!memories.length && !searching ? (
          <EmptyLibrary onCapture={captureFromButton} />
        ) : !results ? (
          visible.length ? (
            <Wall
              label="Library"
              items={visible.map((memory) => ({ memory, why: [] }))}
              onPreview={setPreview}
              onRetry={retry}
            />
          ) : (
            <p className="py-24 text-center text-ink-muted">
              Nothing of this kind in your Library yet.
            </p>
          )
        ) : (
          <>
            {results.direct.length > 0 ? (
              <section aria-labelledby="direct">
                <h2
                  id="direct"
                  className="mb-3 flex items-baseline gap-2 font-display text-lg font-semibold"
                >
                  Direct matches
                  <span className="font-sans text-sm font-normal text-ink-muted tabular">
                    {results.direct.length}
                  </span>
                </h2>
                <Wall
                  label="Direct matches"
                  items={results.direct}
                  query={query}
                  large
                  onPreview={setPreview}
                  onRetry={retry}
                />
              </section>
            ) : (
              <div className="max-w-xl py-8">
                <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">
                  Nothing matches {query ? `“${query}”` : "that"} closely.
                </h2>
                <p className="mt-1 text-ink-muted">
                  {results.related.length
                    ? "These are related, closest first."
                    : "Try fewer words, or describe a colour or what it looked like."}
                </p>
              </div>
            )}
            {results.related.length > 0 && (
              <section
                aria-labelledby="related"
                className="mt-10 border-t border-line pt-6"
              >
                <h2
                  id="related"
                  className="flex items-baseline gap-2 font-display text-lg font-semibold"
                >
                  Related matches
                  <span className="font-sans text-sm font-normal text-ink-muted tabular">
                    {results.related.length}
                  </span>
                </h2>
                <p className="mb-4 text-sm text-ink-muted">
                  Similar in meaning or look, not a confident match.
                </p>
                <Wall
                  label="Related matches"
                  items={results.related}
                  query={query}
                  onPreview={setPreview}
                  onRetry={retry}
                />
              </section>
            )}
          </>
        )}
      </main>

      <CommandDialog
        title="Search your Library"
        open={palette}
        onOpenChange={setPalette}
        shouldFilter={false}
      >
        <CommandInput
          value={draft}
          onValueChange={setDraft}
          placeholder="Describe what you remember…"
          className="text-[1rem] sm:text-md"
        />
        <CommandList>
          {!instant ? (
            <CommandGroup heading="Try">
              {SAMPLE_SEARCHES.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => run(s)}>
                  <SearchIcon className="size-4 text-ink-muted" aria-hidden />{" "}
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <>
              <CommandItem value="__all" onSelect={() => run(draft)}>
                <SearchIcon className="size-4 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  Show all results for “{draft}”
                </span>
                <Kbd>↵</Kbd>
              </CommandItem>
              <CommandEmpty>
                No Memories match yet. Press Enter to search by meaning.
              </CommandEmpty>
              {instant.direct.length > 0 && (
                <CommandGroup heading="Direct matches">
                  {instant.direct.slice(0, 5).map((r) => (
                    <PaletteRow
                      key={r.memory.id}
                      result={r}
                      onSelect={() => {
                        setPalette(false);
                        setPreview(r);
                      }}
                    />
                  ))}
                </CommandGroup>
              )}
              {instant.related.length > 0 && (
                <CommandGroup heading="Related matches">
                  {instant.related.slice(0, 4).map((r) => (
                    <PaletteRow
                      key={r.memory.id}
                      result={r}
                      onSelect={() => {
                        setPalette(false);
                        setPreview(r);
                      }}
                    />
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>

      <QuickPreview
        memory={preview?.memory}
        why={preview?.why}
        query={query}
        onClose={() => setPreview(undefined)}
      />
    </div>
  );
}

function PaletteRow({
  result,
  onSelect,
}: {
  result: Result;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={result.memory.id} onSelect={onSelect}>
      <span className="size-10 shrink-0 overflow-hidden rounded-chip">
        <MemoryVisual
          memory={result.memory}
          className="[&_p]:hidden [&>span]:hidden"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink" dir="auto">
          {result.memory.title}
        </span>
        <span className="block truncate text-xs text-ink-muted">
          {result.why.join(", ")}
        </span>
      </span>
    </CommandItem>
  );
}

function Wall({
  label,
  items,
  query = "",
  large = false,
  onPreview,
  onRetry,
}: {
  label: string;
  items: (Result & { memory: LiveMemory })[];
  query?: string;
  large?: boolean;
  onPreview: (r: Result) => void;
  onRetry: (id: string) => void;
}) {
  const withWhy = items.some((r) => r.why.length > 0);
  const caption = withWhy ? 74 : 48;
  return (
    <Masonry
      label={label}
      items={items}
      getKey={(r) => r.memory.id}
      getAspect={(r) => r.memory.aspect}
      getLabel={(r) => r.memory.title}
      caption={caption}
      minColumnWidth={large ? 300 : 136}
      maxColumns={large ? 4 : 6}
      gap={large ? 16 : 12}
      onOpen={(i) => items[i] && onPreview(items[i])}
      onPreview={(i) => items[i] && onPreview(items[i])}
      renderItem={(r, tile) => (
        <figure className="group h-full cursor-pointer">
          <div
            className="relative overflow-hidden rounded-tile transition-transform duration-[120ms] ease-out group-active:scale-[0.98]"
            style={{ height: tile.height }}
          >
            <Arrival fresh={r.memory.fresh}>
              <MemoryVisual memory={r.memory} query={query} />
            </Arrival>
            <IndexStateBadge
              memory={r.memory}
              onRetry={() => onRetry(r.memory.id)}
              className="absolute right-2 bottom-2"
            />
          </div>
          <figcaption className="min-w-0 px-0.5 pt-2">
            {showsTitle(r.memory) ? (
              <>
                <span className="block truncate text-sm font-medium text-ink">
                  {sourceLabel(r.memory)}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {capturedLabel(r.memory.daysAgo)}
                </span>
              </>
            ) : (
              <>
                <span
                  className="block truncate text-sm font-medium text-ink"
                  dir="auto"
                >
                  {r.memory.title}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {sourceLabel(r.memory)}
                </span>
              </>
            )}
            {withWhy && (
              <span className="mt-1.5 flex gap-1 overflow-hidden">
                {r.why.slice(0, 2).map((w, i) => (
                  <Chip
                    key={w}
                    tone={i === 0 && large ? "spark" : "why"}
                    className="min-w-0 shrink"
                  >
                    <span>{w}</span>
                  </Chip>
                ))}
              </span>
            )}
          </figcaption>
        </figure>
      )}
    />
  );
}
