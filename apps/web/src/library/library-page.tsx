import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Link,
  useNavigate,
  useSearch as useRouteSearch,
} from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { Button, Kbd, Masonry, Toaster, cn, toast } from "@spark/ui";
import { startAnalytics, track } from "../analytics";
import { authClient, endSession, type AppSession } from "../auth";
import { DeskSearchField, DeskSidebar } from "../shell";
import { productMetrics } from "./product-metrics";
import { MemoryTile, tileHeight, tileLabel } from "./memory-tile";
import { LibraryOverlaysHost } from "./overlays-host";
import { MOD, useFileDrop, useLibraryShortcuts } from "./shortcuts";
import { useLibrary, type Memory, type WallMemory } from "./use-library";
import { useSearch, type Found, type Results } from "./use-search";
import { WHY_HEIGHT, WhyChip, whyLabel } from "./why";

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
  const { desk } = useRouteSearch({ from: "/" });
  const [metrics] = useState(() => productMetrics(track));
  const [searchOpen, setSearchOpen] = useState(desk === "search");
  const [overlaysEpoch, setOverlaysEpoch] = useState(0);
  const [overlaysDown, setOverlaysDown] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(desk === "capture");
  const [openId, setOpenId] = useState<string>();
  const [imageId, setImageId] = useState<string>();
  /** The Memory the wall shows More Like This of, instead of a query. */
  const [like, setLike] = useState<Memory>();
  // ⌘K: instant per keystroke, full once typing pauses.
  const instant = useSearch(
    { query: draft },
    library.memories,
    library.version,
    {
      userId: session.user.id,
    }
  );
  // The wall: instant and full at once (often straight from the cache the
  // menu filled), and the last results stay up until new ones land.
  const results = useSearch(
    like ? { like: like.id } : { query },
    library.memories,
    library.version,
    { userId: session.user.id, pauseMs: 0, keepPrevious: true }
  );
  const searching = !!like || !!query;
  const opened = library.memories.find((m) => m.id === openId);
  // The viewer steps through the images of the wall on screen.
  const images = useMemo(() => {
    if (!searching || !results || results === "failed") {
      return library.memories.filter((m) => m.image);
    }
    const live = new Map(library.memories.map((m) => [m.id, m]));
    return [...results.direct, ...results.related].flatMap((m) => {
      const now = live.get(m.id);
      return now?.image ? [now] : [];
    });
  }, [searching, results, library.memories]);

  useEffect(() => {
    startAnalytics(session.user.id);
  }, [session.user.id]);

  const retryOverlays = () => {
    if (!overlaysDown) return;
    setOverlaysDown(false);
    setOverlaysEpoch((n) => n + 1);
  };
  const openSearch = () => {
    retryOverlays();
    metrics.searchOpened();
    setDraft(query);
    setSearchOpen(true);
  };
  const openPasteBox = () => {
    retryOverlays();
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
    setLike(undefined);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };
  const moreLikeThis = (memory: Memory) => {
    setOpenId(undefined);
    setImageId(undefined);
    setQuery("");
    setLike(memory);
    window.scrollTo({ top: 0 });
  };
  const clearSearch = () => {
    setQuery("");
    setLike(undefined);
  };

  useEffect(() => {
    if (desk !== "capture" && desk !== "search") return;
    if (desk === "search") metrics.searchOpened();
    void navigate({ to: "/", search: {}, replace: true });
  }, [desk, metrics, navigate]);

  useLibraryShortcuts({
    onSearch: openSearch,
    onToggleSearch: () => {
      if (overlaysDown) {
        openSearch();
        return;
      }
      if (searchOpen) setSearchOpen(false);
      else openSearch();
    },
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
    endSession();
    await navigate({ to: "/sign-in" });
  };

  const searchLabel = like ? "More Like This" : query || "Search";
  const clearSearchClick = searching
    ? () => {
        metrics.cleared();
        clearSearch();
      }
    : undefined;

  return (
    <div className="flex min-h-dvh bg-canvas">
      <DeskSidebar
        email={session.user.email}
        current="library"
        admin={admin}
        onSignOut={() => void signOut()}
        onLibrary={() => {
          metrics.cleared();
          clearSearch();
        }}
        onCapture={openPasteBox}
        onSearch={openSearch}
        searchLabel={searchLabel}
        searchActive={searching}
        onClearSearch={clearSearchClick}
      />

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 md:hidden">
          <Wordmark />
          {admin && (
            <Link to="/admin" className="text-sm text-ink-muted">
              Admin
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <DeskSearchField
              label={searchLabel}
              active={searching}
              onSearch={openSearch}
              onClear={clearSearchClick}
            />
          </div>
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
              <Button variant="primary" className="h-10" onClick={openPasteBox}>
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
            {/* Until a search's first answer lands, the wall stays as it was. */}
            {searching && results ? (
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

      <LibraryOverlaysHost
        key={overlaysEpoch}
        onCatch={() => setOverlaysDown(true)}
        searchOpen={searchOpen}
        draft={draft}
        instant={instant}
        onSearchOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) metrics.abandoned();
        }}
        onDraft={setDraft}
        onShowOnWall={showOnWall}
        onOpenFromSearch={openFromSearch}
        onCapture={openPasteBox}
        onSettings={() => void navigate({ to: "/settings" })}
        onSignOut={() => void signOut()}
        pasteOpen={pasteOpen}
        onPasteOpenChange={setPasteOpen}
        onPasteCapture={library.capture}
        onImages={captureFiles}
        images={images}
        imageId={imageId}
        onImageId={setImageId}
        onImageClose={() => setImageId(undefined)}
        opened={opened}
        edits={library.edits}
        onDetailClose={() => setOpenId(undefined)}
        onDelete={library.remove}
        onRetry={library.retryUpload}
        onBroken={library.refresh}
        onRetryIndexing={library.retryIndexing}
        onAiOptOut={library.setAiOptOut}
        onMoreLikeThis={moreLikeThis}
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
      <Toaster />
    </div>
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

/**
 * Results on the wall: each tile with its why-chip under it, every tile
 * the same caption height so a chip arriving never moves anything, and
 * tiles that change place when the full answer lands glide there.
 */
function ResultWall({
  label,
  found,
  direct,
  glideKey,
  query,
  onOpen,
  tiles,
}: {
  label: string;
  found: Found[];
  /** The search these answer: reordering within it glides (Masonry). */
  glideKey: string;
  /** Direct or Related; undefined for More Like This, which needs no why-chip. */
  direct?: boolean;
  query: string;
  onOpen: (memory: Memory) => void;
  tiles: TileActions;
}) {
  const open = (i: number) => found[i] && onOpen(found[i]);
  return (
    <Masonry
      label={label}
      items={found}
      getKey={(m) => m.id}
      getHeight={tileHeight}
      getCaption={() => (direct === undefined ? 0 : WHY_HEIGHT)}
      getLabel={(m) =>
        [tileLabel(m), direct !== undefined && whyLabel(m)]
          .filter(Boolean)
          .join(", ")
      }
      onOpen={open}
      onPreview={open}
      glideKey={glideKey}
      renderItem={(m, tile) => (
        <div className="flex h-full flex-col items-start">
          <div className="w-full" style={{ height: tile.height }}>
            <MemoryTile
              memory={m}
              query={query}
              width={tile.width}
              {...tiles}
            />
          </div>
          {direct !== undefined && <WhyChip found={m} direct={direct} />}
        </div>
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
  // More Like This: one wall, nearest first, no headings or chips. Read
  // from the answer itself, so a previous search's results keep their own
  // layout until the new answer lands.
  if (results.key.startsWith("like:")) {
    const found = [...results.direct, ...results.related];
    return (
      <div data-search={results.mode}>
        <Landing
          key={results.key}
          className={cn(
            found.length ? "sr-only" : "text-sm font-medium text-ink-muted"
          )}
        >
          {found.length ? "More Like This" : "Nothing Like This"}
        </Landing>
        <ResultWall
          label="More Like This"
          found={found}
          glideKey={results.key}
          query=""
          onOpen={onOpen}
          tiles={tiles}
        />
      </div>
    );
  }
  return (
    <div data-search={results.mode}>
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">
          {results.direct.length ? "Direct Matches" : "No Direct Matches"}
        </h2>
        {results.direct.length > 0 && (
          <ResultWall
            label="Direct Matches"
            found={results.direct}
            direct
            glideKey={results.key}
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
          <ResultWall
            label="Related Matches"
            found={results.related}
            direct={false}
            glideKey={results.key}
            query={query}
            onOpen={onOpen}
            tiles={tiles}
          />
        </section>
      )}
    </div>
  );
}

/**
 * A heading that takes focus when it appears: More Like This replaces the
 * tile that had focus, so focus lands on what replaced it, not on nothing.
 */
function Landing({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <h2 ref={ref} tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </h2>
  );
}
