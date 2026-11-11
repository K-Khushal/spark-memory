import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { LogOutIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  Button,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
  Masonry,
  Toaster,
  cn,
  toast,
} from "@spark/ui";
import { startAnalytics, stopAnalytics, track } from "../analytics";
import { authClient, clearAdminCache, type AppSession } from "../auth";
import { DeskSidebar } from "../shell";
import { productMetrics } from "./product-metrics";
import { MemoryDetail } from "./memory-detail";
import { MemoryTile, memoryName, tileHeight, tileLabel } from "./memory-tile";
import { PasteBox } from "./paste-box";
import { ImageViewer } from "./image-viewer";
import { MOD, useFileDrop, useLibraryShortcuts } from "./shortcuts";
import { useLibrary, type Memory, type WallMemory } from "./use-library";
import { useInstantSearch, type Results } from "./use-search";

/**
 * The Library: sidebar (a top bar on phones) beside the masonry wall of
 * Memories (DESIGN.md → Pick). ⌘V Captures, ⌘K searches, a tile opens its
 * Memory.
 */
export function LibraryPage({
  session,
  admin,
}: {
  session: AppSession;
  admin: boolean;
}) {
  const navigate = useNavigate();
  const library = useLibrary();
  const [metrics] = useState(() => productMetrics(track));
  const [searchOpen, setSearchOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [imageId, setImageId] = useState<string>();
  const instant = useInstantSearch(draft, library.memories, library.version);
  const results = useInstantSearch(query, library.memories, library.version);
  const opened = library.memories.find((m) => m.id === openId);
  // The viewer steps through the images of the wall on screen.
  const images = useMemo(() => {
    if (!query || !results || results === "failed") {
      return library.memories.filter((m) => m.image);
    }
    const live = new Map(library.memories.map((m) => [m.id, m]));
    return [...results.direct, ...results.related].flatMap((m) => {
      const now = live.get(m.id);
      return now?.image ? [now] : [];
    });
  }, [query, results, library.memories]);

  useEffect(() => {
    startAnalytics(session.user.id);
  }, [session.user.id]);

  const openSearch = () => {
    metrics.searchOpened();
    setDraft(query);
    setSearchOpen(true);
  };
  const openPasteBox = () => {
    setSearchOpen(false);
    setPasteOpen(true);
  };
  const reveal = (memory: Memory) => {
    setSearchOpen(false);
    if (memory.kind === "image") setImageId(memory.id);
    else setOpenId(memory.id);
  };
  const openMemory = (memory: Memory) => {
    metrics.found();
    reveal(memory);
  };
  const openFromSearch = (memory: Memory) => {
    if (instant && instant !== "failed") {
      metrics.choseResult(draft, {
        direct: instant.direct.length,
        related: instant.related.length,
      });
    }
    reveal(memory);
  };
  const captureFiles = (files: File[]) => {
    setPasteOpen(false);
    void library.captureImages(files);
  };
  const dropping = useFileDrop(captureFiles);
  const tiles: TileActions = {
    onRetry: library.retryUpload,
    onBroken: library.refresh,
    onDelete: library.remove,
    onRetryIndexing: library.retryIndexing,
  };
  const showOnWall = (q: string) => {
    const trimmed = q.trim();
    if (instant && instant !== "failed") {
      metrics.committedSearch(trimmed, {
        direct: instant.direct.length,
        related: instant.related.length,
      });
    }
    setQuery(trimmed);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };

  useLibraryShortcuts({
    onSearch: openSearch,
    onToggleSearch: () => (searchOpen ? setSearchOpen(false) : openSearch()),
    // Office apps put a picture of copied text beside it: text wins.
    onPaste: (data) => {
      const text = data.getData("text/plain");
      if (data.files.length && !text.trim()) captureFiles([...data.files]);
      else void library.capture(text);
    },
  });

  const signOut = async () => {
    setSearchOpen(false);
    const { error } = await authClient.signOut().catch(() => ({ error: true }));
    if (error) {
      toast("Sign Out Did Not Finish", {
        action: { label: "Try Again", onClick: () => void signOut() },
      });
      return;
    }
    stopAnalytics();
    clearAdminCache();
    await navigate({ to: "/sign-in" });
  };

  const search = (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={openSearch}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-control bg-surface px-2.5 text-left text-sm text-ink-muted shadow-raised transition-[transform,color] duration-(--duration-press) ease-out hover:text-ink active:scale-[0.97]"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden />
        <span
          className={cn("min-w-0 flex-1 truncate", query && "text-ink")}
          dir="auto"
        >
          {query || "Search"}
        </span>
        {!query && <Kbd className="hidden md:inline-flex">{MOD}K</Kbd>}
      </button>
      {query && (
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Clear Search"
          onClick={() => {
            metrics.cleared();
            setQuery("");
          }}
        >
          <XIcon aria-hidden />
        </Button>
      )}
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh bg-canvas">
        <DeskSidebar
          email={session.user.email}
          current="library"
          admin={admin}
          onSignOut={() => void signOut()}
          onLibrary={() => {
            metrics.cleared();
            setQuery("");
          }}
          headerAction={
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label="Capture"
              onClick={openPasteBox}
            >
              <PlusIcon aria-hidden />
            </Button>
          }
        >
          {search}
        </DeskSidebar>

        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 md:hidden">
            <Wordmark />
            {admin && (
              <Link to="/admin" className="text-sm text-ink-muted">
                Admin
              </Link>
            )}
            <div className="min-w-0 flex-1">{search}</div>
            <Button
              variant="primary"
              size="icon"
              aria-label="Capture"
              onClick={openPasteBox}
            >
              <PlusIcon aria-hidden />
            </Button>
          </div>
          <h1 className="sr-only">Library</h1>
          {library.state === "failed" ? (
            <Centred title="Library Is Unreachable">
              <Button variant="outline" onClick={library.retry}>
                Try Again
              </Button>
            </Centred>
          ) : library.state === "loading" ? null : !library.memories.length ? (
            <Centred title="No Memories Yet">
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="primary"
                  className="h-10"
                  onClick={openPasteBox}
                >
                  <PlusIcon aria-hidden /> Capture
                  <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
                    {MOD}V
                  </Kbd>
                </Button>
                <Button variant="outline" className="h-10" onClick={openSearch}>
                  <SearchIcon aria-hidden /> Search
                  <Kbd className="hidden sm:inline-flex">{MOD}K</Kbd>
                </Button>
              </div>
            </Centred>
          ) : (
            <div className="p-4 md:p-6">
              {query ? (
                <SearchResults
                  results={results}
                  query={query}
                  onOpen={openMemory}
                  tiles={tiles}
                />
              ) : (
                <Wall
                  label="All Memories"
                  memories={library.memories}
                  query=""
                  onOpen={openMemory}
                  tiles={tiles}
                />
              )}
            </div>
          )}
        </main>

        <CommandDialog
          title="Search"
          open={searchOpen}
          onOpenChange={(open) => {
            setSearchOpen(open);
            if (!open) metrics.abandoned();
          }}
          shouldFilter={false}
        >
          <CommandInput
            value={draft}
            onValueChange={setDraft}
            placeholder="Search…"
            className="text-[1rem] md:text-md"
          />
          <CommandList>
            {draft.trim() ? (
              instant === "failed" ? (
                <ListNote>Search Is Unreachable</ListNote>
              ) : instant &&
                instant.direct.length + instant.related.length === 0 ? (
                <ListNote>No Direct Matches</ListNote>
              ) : (
                instant && (
                  <>
                    <CommandItem
                      value="__wall"
                      onSelect={() => showOnWall(draft)}
                    >
                      <SearchIcon
                        className="size-4 text-ink-muted"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {draft}
                      </span>
                      <Kbd>↵</Kbd>
                    </CommandItem>
                    {instant.direct.length ? (
                      <ResultGroup
                        heading="Direct Matches"
                        memories={instant.direct.slice(0, 6)}
                        onOpen={openFromSearch}
                      />
                    ) : (
                      <ListNote>No Direct Matches</ListNote>
                    )}
                    <ResultGroup
                      heading="Related Matches"
                      memories={instant.related.slice(0, 4)}
                      onOpen={openFromSearch}
                    />
                  </>
                )
              )
            ) : (
              <CommandGroup>
                <Action
                  icon={<PlusIcon />}
                  hint={`${MOD}V`}
                  onSelect={openPasteBox}
                >
                  Capture
                </Action>
                <Action icon={<LogOutIcon />} onSelect={() => void signOut()}>
                  Sign Out
                </Action>
              </CommandGroup>
            )}
          </CommandList>
        </CommandDialog>

        <PasteBox
          open={pasteOpen}
          onOpenChange={setPasteOpen}
          onCapture={library.capture}
          onImages={captureFiles}
        />
        <ImageViewer
          memories={images}
          openId={imageId}
          onOpen={setImageId}
          onClose={() => setImageId(undefined)}
          onDelete={library.remove}
          onRetry={library.retryUpload}
          onBroken={library.refresh}
          onRetryIndexing={library.retryIndexing}
          onAiOptOut={library.setAiOptOut}
        />
        {dropping && (
          <div
            aria-hidden
            className="pointer-events-none fixed inset-2 z-[60] grid place-items-center rounded-panel bg-canvas/70 shadow-[inset_0_0_0_2px_var(--ring)]"
          >
            <span className="rounded-control bg-surface px-3 py-2 text-sm font-medium text-ink shadow-overlay">
              Drop to Capture
            </span>
          </div>
        )}
        <MemoryDetail
          memory={opened}
          edits={library.edits}
          onClose={() => setOpenId(undefined)}
          onDelete={library.remove}
          onRetryIndexing={library.retryIndexing}
          onAiOptOut={library.setAiOptOut}
        />
        <Toaster />
      </div>
    </MotionConfig>
  );
}

/** A line in the ⌘K list where results would be. */
function ListNote({ children }: { children: string }) {
  return (
    <p role="status" className="py-6 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

function Wordmark() {
  return <span className="font-display text-md font-semibold">Spark</span>;
}

/** A whole-wall message with one way forward. */
function Centred({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-4 md:min-h-dvh">
      <div className="flex flex-col items-center gap-5">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** What a tile can ask of the Library: Try Again or Delete for an upload, Retry for Indexing, fresh URLs for a broken image. */
type TileActions = {
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onDelete: (memory: WallMemory) => void;
  onRetryIndexing: (memory: WallMemory) => void;
};

function Wall({
  label,
  memories,
  query,
  onOpen,
  tiles,
}: {
  label: string;
  memories: WallMemory[];
  query: string;
  onOpen: (memory: Memory) => void;
  tiles: TileActions;
}) {
  const open = (i: number) => memories[i] && onOpen(memories[i]);
  return (
    <Masonry
      label={label}
      items={memories}
      getKey={(m) => m.id}
      getHeight={tileHeight}
      getLabel={tileLabel}
      onOpen={open}
      onPreview={open}
      renderItem={(m, tile) => (
        <MemoryTile memory={m} query={query} width={tile.width} {...tiles} />
      )}
    />
  );
}

/** Direct Matches first, Related Matches apart (DESIGN.md → Interaction baseline). */
function SearchResults({
  results,
  query,
  onOpen,
  tiles,
}: {
  results: Results | "failed" | undefined;
  query: string;
  onOpen: (memory: Memory) => void;
  tiles: TileActions;
}) {
  if (!results) return null;
  if (results === "failed") {
    return (
      <h2 className="text-sm font-medium text-ink-muted">
        Search Is Unreachable
      </h2>
    );
  }
  return (
    <>
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">
          {results.direct.length ? "Direct Matches" : "No Direct Matches"}
        </h2>
        {results.direct.length > 0 && (
          <Wall
            label="Direct Matches"
            memories={results.direct}
            query={query}
            onOpen={onOpen}
            tiles={tiles}
          />
        )}
      </section>
      {results.related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">
            Related Matches
          </h2>
          <Wall
            label="Related Matches"
            memories={results.related}
            query={query}
            onOpen={onOpen}
            tiles={tiles}
          />
        </section>
      )}
    </>
  );
}

function ResultGroup({
  heading,
  memories,
  onOpen,
}: {
  heading: string;
  memories: Memory[];
  onOpen: (memory: Memory) => void;
}) {
  if (!memories.length) return null;
  return (
    <CommandGroup heading={heading}>
      {memories.map((memory) => (
        <CommandItem
          key={memory.id}
          value={memory.id}
          onSelect={() => onOpen(memory)}
        >
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {memoryName(memory)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function Action({
  icon,
  hint,
  onSelect,
  children,
}: {
  icon: ReactNode;
  hint?: string;
  onSelect: () => void;
  children: string;
}) {
  return (
    <CommandItem value={children} onSelect={onSelect}>
      <span className="text-ink-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {hint && <Kbd>{hint}</Kbd>}
    </CommandItem>
  );
}
