import { emptySelection, select } from "./selection";
import { SelectionBar } from "./selection-bar";
import {
  ImageQueryControls,
  memoryImageQuery,
  LikeSourceChip,
  QueryImageChip,
  useImageQuery,
  type ImageQueryProps,
} from "./image-query";
import type { SearchChips } from "@spark/core";
import { isWordless, requestKey } from "./search-session";
import {
  KIND_LABELS,
  LibraryFilters,
  useFilterOptions,
} from "./library-filters";
import { ManageCategories } from "./manage-categories";
import { narrowing } from "./narrowing";
import { OwnCategoryNames, useOwnCategories } from "./own-categories";
import { recordSearch } from "./search-history";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Link,
  useNavigate,
  useSearch as useRouteSearch,
} from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import {
  Button,
  FilterChip,
  Kbd,
  Masonry,
  Toaster,
  cn,
  toast,
  type MasonryHandle,
  type MasonrySelection,
} from "@spark/ui";
import { startAnalytics, track } from "../analytics";
import { authClient, endSession, type AppSession } from "../auth";
import { ShareTarget } from "../pwa/share-target";
import {
  Centred,
  DeskSearchField,
  DeskSidebar,
  focusDeskControl,
  SkipLink,
} from "../shell";
import { useStickyInset } from "../sticky-inset";
import { productMetrics } from "./product-metrics";
import { createActivation } from "./activation";
import { Onboarding, recordActivation } from "./onboarding";
import { MemoryTile, tileHeight, tileLabel } from "./memory-tile";
import { LibraryOverlaysHost } from "./overlays-host";
import { pdfMatch, type PdfMatch } from "./pdf-match";
import { focusWall } from "./focus";
import { MOD, useFileDrop } from "./shortcuts";
import { useLibrary, type Memory, type WallMemory } from "./use-library";
import {
  useMoreResults,
  useSearch,
  type Found,
  type Results,
} from "./use-search";
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
  const bar = useRef<HTMLDivElement>(null);
  useStickyInset(bar);
  const library = useLibrary(session.user.id);
  const { desk, memory: linked } = useRouteSearch({ from: "/" });
  const [metrics] = useState(() => productMetrics(track));
  const [activationVersion, setActivationVersion] = useState(0);
  const [activation] = useState(() => createActivation(recordActivation));
  const onActivated = useCallback(() => activation.know(), [activation]);
  const [searchOpen, setSearchOpen] = useState(desk === "search");
  const [overlaysEpoch, setOverlaysEpoch] = useState(0);
  const [overlaysDown, setOverlaysDown] = useState(false);
  const previousSearch = useRef("");
  const [draft, setDraft] = useState("");
  const {
    value: visual,
    change: setVisual,
    choose: decodeImage,
    busy: imageBusy,
  } = useImageQuery();
  const [query, setQuery] = useState("");
  /** The filter chips, one choice per group; they work with no words. */
  const [chips, setChips] = useState<SearchChips>({});
  const [pasteOpen, setPasteOpen] = useState(desk === "capture");
  /** Set when this page was opened to show Capture or Search, then cleared on close. */
  const deskReturn = useRef<"capture" | "search" | null>(
    desk === "capture" || desk === "search" ? desk : null
  );
  const [openId, setOpenId] = useState<string>();
  const [imageId, setImageId] = useState<string>();
  /** The PDF in the viewer, and where it opens. */
  const [pdf, setPdf] = useState<{ id: string; match: PdfMatch }>();
  /** The Memory the wall shows More Like This of, instead of a query. */
  const [like, setLike] = useState<Memory>();
  const chooseImage = (file?: File) => {
    setLike(undefined);
    return decodeImage(file);
  };
  const queryImage: ImageQueryProps = {
    value: visual,
    busy: imageBusy,
    onFile: chooseImage,
    onChange: (value) => {
      setLike(undefined);
      setVisual(value);
    },
  };
  // Shared by the menu, wall and further pages. Keystrokes only read this lookup.
  const memoriesById = useMemo(
    () => new Map(library.memories.map((memory) => [memory.id, memory])),
    [library.memories]
  );
  // ⌘K: instant per keystroke, full once typing pauses.
  const { results: instant, ...instantSearch } = useSearch(
    searchOpen ? { query: draft, ...(visual && { visual, chips }) } : undefined,
    memoriesById,
    library.version,
    {
      userId: session.user.id,
    }
  );
  // The wall: instant and full at once (often straight from the cache the
  // menu filled), and the last results stay up until new ones land.
  const filtering = Object.keys(chips).length > 0;
  const request = like
    ? { like: like.id }
    : { query, ...(visual && { visual }), ...(filtering && { chips }) };
  const { results: first, ...wallSearch } = useSearch(
    request,
    memoriesById,
    library.version,
    { userId: session.user.id, pauseMs: 0, keepPrevious: true }
  );
  const more = useMoreResults(request, first, memoriesById);
  const results = useMemo(
    () =>
      first && first !== "failed" && (more.direct.length || more.related.length)
        ? {
            ...first,
            direct: [...first.direct, ...more.direct],
            related: [...first.related, ...more.related],
          }
        : first,
    [first, more.direct, more.related]
  );
  const searching = !!visual || !!like || !!query || filtering;
  /** The results on the wall answer an earlier search: the new answer is still on its way. */
  const pending =
    searching &&
    first !== "failed" &&
    (!first || first.key !== requestKey(request));
  /**
   * Until when focus goes to the results once they land: Enter in ⌘K
   * replaces the wall, and the tile that held focus goes with it.
   */
  const focusResults = useRef(0);
  useEffect(() => {
    if (!results || pending || performance.now() > focusResults.current) return;
    const frame = requestAnimationFrame(() => {
      focusResults.current = 0;
      focusWall({ onlyIfLost: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [results, pending]);
  /** Set by Show More, so focus is not lost when its last page lands. */
  const pagingFocus = useRef(false);
  const paging = more.canLoad || more.busy;
  useEffect(() => {
    if (paging || !pagingFocus.current) return;
    pagingFocus.current = false;
    // Where Show More was: not a jump to the top of a long wall.
    focusWall({ onlyIfLost: true, preventScroll: true });
  }, [paging]);
  const categories = useOwnCategories({
    onRenamed: (from, to) => {
      library.categoryRenamed(from, to);
      setChips((now) =>
        now.category === from ? { ...now, category: to } : now
      );
    },
    onRemoved: (name) => {
      library.categoryRemoved(name);
      // A filter on a Category that is gone would only ever show nothing.
      setChips(({ category, ...rest }) =>
        category === name ? rest : { ...rest, ...(category && { category }) }
      );
    },
    onFinished: library.syncCategories,
  });
  const ownNames = useMemo(
    () => categories.state?.categories.map((c) => c.name) ?? [],
    [categories.state]
  );
  const filterOptions = useFilterOptions(library.memories, ownNames);
  const manage = (layout: "sidebar" | "row") => (
    <ManageCategories
      layout={layout}
      state={categories.state}
      actions={categories}
    />
  );
  const opened = library.memories.find((m) => m.id === openId);
  // The viewer steps through the images of the wall on screen.
  const images = useMemo(() => {
    if (!searching || !results || results === "failed") {
      return library.memories.filter((m) => m.kind === "image" && m.image);
    }
    const live = new Map(library.memories.map((m) => [m.id, m]));
    return [...results.direct, ...results.related].flatMap((m) => {
      const now = live.get(m.id);
      return now?.kind === "image" && now.image ? [now] : [];
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
  /** Opens a Memory (a search result says what matched in it, `query` how). */
  const [videoSeconds, setVideoSeconds] = useState<number>();
  const reveal = (memory: Memory | Found, typed = query) => {
    setSearchOpen(false);
    setVideoSeconds(
      "part" in memory && memory.part?.kind === "passage"
        ? memory.part.seconds
        : undefined
    );
    if (memory.kind === "image") setImageId(memory.id);
    else if (memory.kind === "pdf") {
      setPdf({
        id: memory.id,
        match: "part" in memory ? pdfMatch(memory, typed) : {},
      });
    } else setOpenId(memory.id);
  };
  const activate = (id: string) => {
    void activation.activate(id).then((result) => {
      if (result === "recorded" || result === "unchanged")
        setActivationVersion((v) => v + 1);
    });
  };
  const openMemory = (memory: Memory) => {
    if (
      query.trim() &&
      results &&
      results !== "failed" &&
      results.key === `q:${query}` &&
      [...results.direct, ...results.related].some((m) => m.id === memory.id)
    )
      activate(memory.id);
    metrics.found();
    if ((query || filtering) && results && results !== "failed") {
      const hits = [...results.direct, ...results.related];
      recordSearch(query, {
        memoryId: memory.id,
        position: hits.findIndex((m) => m.id === memory.id) + 1,
      });
    }
    reveal(memory);
  };
  const openFromSearch = (memory: Memory) => {
    if (instant && instant !== "failed") {
      metrics.choseResult(draft, {
        direct: instant.direct.length,
        related: instant.related.length,
      });
    }
    const hits =
      instant && instant !== "failed"
        ? [...instant.direct.slice(0, 6), ...instant.related.slice(0, 4)]
        : [];
    recordSearch(draft, {
      memoryId: memory.id,
      position: hits.findIndex((m) => m.id === memory.id) + 1,
    });
    if (
      draft.trim() &&
      instant &&
      instant !== "failed" &&
      [...instant.direct, ...instant.related].some((m) => m.id === memory.id)
    )
      activate(memory.id);
    reveal(memory, draft);
  };
  const captureFiles = (files: File[]) => {
    setPasteOpen(false);
    void library.captureFiles(files);
  };
  const dropping = useFileDrop(captureFiles);
  const [selected, setSelected] = useState(emptySelection);
  // Only what the wall shows can be selected: nothing while results are pending or failed.
  const wallOrder = searching
    ? results && results !== "failed"
      ? [...results.direct, ...results.related].map((m) => m.id)
      : []
    : library.memories.map((m) => m.id);
  const selectable = new Set(
    library.memories
      .filter((m) => !m.upload && !library.isPending(m.id))
      .map((m) => m.id)
  );
  const order = wallOrder.filter((id) => selectable.has(id));
  // A search or filter can take Memories off the wall; a bulk action never reaches them.
  const pruned = select(selected, order, { type: "prune" });
  if (pruned !== selected) setSelected(pruned);
  const visible = pruned.ids;
  const selection: MasonrySelection = {
    ids: visible,
    choose: (id, mode) =>
      setSelected((s) => select(s, order, { type: mode, id })),
    all: () => setSelected((s) => select(s, order, { type: "all" })),
    clear: () => setSelected(emptySelection),
    marquee: (ids, additive) =>
      setSelected((s) =>
        select(s, order, {
          type: "marquee",
          ids,
          additive: additive ? s.ids : [],
        })
      ),
  };
  const bulkRows = useMemo(() => {
    const visibleIds = new Set(visible);
    return library.memories.filter((m) => visibleIds.has(m.id));
  }, [visible, library.memories]);
  const tiles: TileActions = {
    selection,
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
    recordSearch(
      trimmed,
      undefined,
      !!previousSearch.current && previousSearch.current !== trimmed
    );
    previousSearch.current = trimmed;
    focusResults.current = performance.now() + 10_000;
    setQuery(trimmed);
    setLike(undefined);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };
  const moreLikeThis = (memory: Memory) => {
    setVisual(undefined);
    setOpenId(undefined);
    setImageId(undefined);
    setPdf(undefined);
    setQuery("");
    setLike(memory);
    window.scrollTo({ top: 0 });
  };
  const searchByImage = (memory: Memory) => {
    setOpenId(undefined);
    setImageId(undefined);
    setPdf(undefined);
    setSearchOpen(false);
    setQuery("");
    setDraft("");
    setLike(undefined);
    setVisual(memoryImageQuery(memory));
    window.scrollTo({ top: 0 });
  };
  const changeChips = (next: SearchChips) => {
    setChips(next);
    setLike(undefined);
  };
  const clearSearch = () => {
    setVisual(undefined);
    setChips({});
    setQuery("");
    setLike(undefined);
  };

  // Activity links resolve through the owner-scoped single-Memory endpoint,
  // even while later Library pages are still arriving.
  const { loadMemory } = library;
  useEffect(() => {
    if (!linked) return;
    let cancelled = false;
    void loadMemory(linked).then(
      (memory) => {
        if (cancelled) return;
        if (memory) {
          setSearchOpen(false);
          setVideoSeconds(undefined);
          if (memory.kind === "image") setImageId(memory.id);
          else if (memory.kind === "pdf") setPdf({ id: memory.id, match: {} });
          else setOpenId(memory.id);
        }
        void navigate({ to: "/", search: {}, replace: true });
      },
      () => {
        if (!cancelled) void navigate({ to: "/", search: {}, replace: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [linked, loadMemory, navigate]);

  useEffect(() => {
    if (desk !== "capture" && desk !== "search") return;
    if (desk === "search") metrics.searchOpened();
    void navigate({ to: "/", search: {}, replace: true });
  }, [desk, metrics, navigate]);

  useEffect(() => {
    const which = deskReturn.current;
    if (!which) return;
    if (which === "search" ? searchOpen : pasteOpen) return;
    deskReturn.current = null;
    const frame = requestAnimationFrame(() => focusDeskControl(which));
    return () => cancelAnimationFrame(frame);
  }, [searchOpen, pasteOpen]);

  const toggleSearch = () => {
    if (overlaysDown) {
      openSearch();
      return;
    }
    if (searchOpen) setSearchOpen(false);
    else openSearch();
  };
  // Office apps put a picture of copied text beside it: text wins.
  const pasteOntoWall = (data: DataTransfer) => {
    const text = data.getData("text/plain");
    if (data.files.length && !text.trim()) captureFiles([...data.files]);
    else void library.capture(text);
  };

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

  const searchLabel = like
    ? "More Like This"
    : visual
      ? "Image"
      : query || "Search";
  const clearSearchClick = searching
    ? () => {
        metrics.cleared();
        clearSearch();
      }
    : undefined;

  return (
    <div
      className="flex min-h-dvh bg-canvas"
      onPasteCapture={(event) => {
        if (
          (event.target as HTMLElement).closest('[data-desk="search"]') &&
          event.clipboardData.files[0]
        ) {
          event.preventDefault();
          event.stopPropagation();
          void chooseImage(event.clipboardData.files[0]);
        }
      }}
      onDropCapture={(event) => {
        if (
          (event.target as HTMLElement).closest('[data-desk="search"]') &&
          event.dataTransfer.files[0]
        ) {
          event.preventDefault();
          event.stopPropagation();
          void chooseImage(event.dataTransfer.files[0]);
        }
      }}
    >
      <SkipLink />
      <DeskSidebar
        filtered={filtering}
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
        onToggleSearch={toggleSearch}
        onPaste={pasteOntoWall}
        searchLabel={searchLabel}
        searchActive={searching}
        searchImageControl={
          <ImageQueryControls {...queryImage} showChip={false} />
        }
        onClearSearch={clearSearchClick}
        filters={
          (library.memories.length > 0 || visual || imageBusy) && (
            <LibraryFilters
              layout="sidebar"
              leading={
                <>
                  <LikeSourceChip
                    memory={like}
                    onClear={() => setLike(undefined)}
                  />
                  <QueryImageChip {...queryImage} />
                </>
              }
              options={filterOptions}
              chips={chips}
              onChange={changeChips}
              manage={manage("sidebar")}
            />
          )
        }
      />

      <main
        id="content"
        tabIndex={-1}
        className="min-w-0 flex-1 pb-32 outline-none"
      >
        <div
          ref={bar}
          className="sticky top-0 z-20 border-b border-line bg-canvas md:hidden"
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Wordmark />
            {admin && (
              <Link to="/admin" className="text-sm text-ink-muted">
                Admin
              </Link>
            )}
            <div className="min-w-0 flex-1 basis-56">
              <DeskSearchField
                label={searchLabel}
                active={searching}
                imageControl={
                  <ImageQueryControls {...queryImage} showChip={false} />
                }
                onSearch={openSearch}
                onClear={clearSearchClick}
              />
            </div>
            <Button
              variant="primary"
              size="icon"
              aria-label="Capture"
              data-desk="capture"
              onClick={openPasteBox}
            >
              <PlusIcon aria-hidden />
            </Button>
          </div>
          {(library.memories.length > 0 || visual || imageBusy) && (
            <LibraryFilters
              layout="row"
              leading={
                <>
                  <LikeSourceChip
                    memory={like}
                    onClear={() => setLike(undefined)}
                  />
                  <QueryImageChip {...queryImage} />
                </>
              }
              options={filterOptions}
              chips={chips}
              onChange={changeChips}
              manage={manage("row")}
            />
          )}
        </div>
        <h1 className="sr-only">Library</h1>
        {library.state === "ready" && (
          <Onboarding
            activationVersion={activationVersion}
            onActivated={onActivated}
            memories={library.memories}
            refresh={library.refreshSamples}
            onCapture={openPasteBox}
            onOpen={reveal}
            onSearch={(q) => {
              openSearch();
              setDraft(q);
            }}
          />
        )}

        {library.state === "failed" ? (
          <Centred title="Library Is Unreachable" level={2}>
            <Button variant="outline" onClick={library.retry}>
              Try Again
            </Button>
          </Centred>
        ) : library.state === "loading" ? null : !library.memories.length ? (
          <Centred title="No Memories Yet" level={2}>
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
          <div
            aria-busy={pending}
            className={cn(
              "p-4 transition-opacity md:p-6",
              // A slow answer dims what is shown; a quick one never does.
              pending
                ? "opacity-60 delay-300 duration-(--duration-press)"
                : "opacity-100 duration-(--duration-press)"
            )}
          >
            {/* Until a search's first answer lands, the wall stays as it was. */}
            {searching && results ? (
              <SearchResults
                results={results}
                onRetry={wallSearch.retry}
                retrying={wallSearch.retrying}
                query={query}
                chips={chips}
                onChips={changeChips}
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
            {paging && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="outline"
                  // Not `disabled`: that would drop the focus it holds.
                  aria-disabled={more.busy}
                  className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  onClick={() => {
                    if (more.busy) return;
                    pagingFocus.current = true;
                    void more.load();
                  }}
                >
                  Show More
                </Button>
              </div>
            )}
          </div>
        )}
      </main>

      {bulkRows.length > 0 && (
        <SelectionBar
          count={bulkRows.length}
          ownNames={ownNames}
          onClear={selection.clear}
          onDelete={() => {
            library.bulk(bulkRows, { operation: "delete" });
            selection.clear();
          }}
          onCategories={(categories) => {
            library.bulk(bulkRows, { operation: "categories", categories });
            selection.clear();
          }}
        />
      )}
      <OwnCategoryNames.Provider value={ownNames}>
        <LibraryOverlaysHost
          key={overlaysEpoch}
          onCatch={() => setOverlaysDown(true)}
          searchOpen={searchOpen}
          imageQuery={queryImage}
          draft={draft}
          instant={instant}
          onRetrySearch={() => {
            // One failure shows in both places: one Try Again asks for both.
            instantSearch.retry();
            wallSearch.retry();
          }}
          retryingSearch={instantSearch.retrying || wallSearch.retrying}
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
          onFiles={captureFiles}
          images={images}
          imageId={imageId}
          onImageId={setImageId}
          onImageClose={() => setImageId(undefined)}
          pdf={library.memories.find((m) => m.id === pdf?.id)}
          pdfMatch={pdf?.match ?? {}}
          onPdfClose={() => setPdf(undefined)}
          videoSeconds={videoSeconds}
          opened={opened}
          edits={library.edits}
          onDetailClose={() => setOpenId(undefined)}
          onDelete={library.remove}
          onRetry={library.retryUpload}
          onBroken={library.refresh}
          onRetryIndexing={library.retryIndexing}
          onRetryDeepFetch={library.retryDeepFetch}
          onCategories={library.setCategories}
          onAiOptOut={library.setAiOptOut}
          onMoreLikeThis={moreLikeThis}
          onSearchByImage={searchByImage}
        />
      </OwnCategoryNames.Provider>
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
      <ShareTarget library={library.edits} />
    </div>
  );
}

function Wordmark() {
  return <span className="font-display text-md font-semibold">Spark</span>;
}

/** What a tile can ask of the Library: Try Again or Delete for an upload, Retry for Indexing, fresh URLs for a broken image. */
type TileActions = {
  selection: MasonrySelection;
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
      selection={tiles.selection}
      items={memories}
      getKey={(m) => m.id}
      getHeight={tileHeight}
      getLabel={tileLabel}
      onOpen={open}
      onPreview={open}
      // Only a Memory moved to the top by a repeat Capture glides there.
      glideKey="library"
      glide={memories.some((m) => m.resurfaced)}
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
  handle,
  onEdge,
}: {
  label: string;
  found: Found[];
  /** Focus moves between the Direct and Related walls through these. */
  handle?: Ref<MasonryHandle>;
  onEdge?: (key: "ArrowUp" | "ArrowDown") => string | undefined;
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
      selection={tiles.selection}
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
      handle={handle}
      onEdge={onEdge}
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
  onRetry,
  retrying,
  query,
  chips,
  onChips,
  onOpen,
  tiles,
}: {
  results: Results | "failed" | undefined;
  onRetry: () => void;
  retrying: boolean;
  query: string;
  chips: SearchChips;
  onChips: (chips: SearchChips) => void;
  onOpen: (memory: Memory) => void;
  tiles: TileActions;
}) {
  const direct = useRef<MasonryHandle>(null);
  const related = useRef<MasonryHandle>(null);
  const headings = useId();
  if (!results) return null;
  if (results === "failed") {
    return (
      <div className="flex flex-col items-start gap-3">
        <h2
          tabIndex={-1}
          className="text-sm font-medium text-ink-muted outline-none"
        >
          Search Is Unreachable
        </h2>
        <Button
          variant="outline"
          // Not `disabled`: that would drop the focus it holds.
          aria-disabled={retrying}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => !retrying && onRetry()}
        >
          Try Again
        </Button>
      </div>
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
  // Filters alone: one wall of what they found, each with why it did, and
  // no Direct and Related to tell apart.
  if (isWordless(results.key)) {
    const found = [...results.direct, ...results.related];
    return (
      <div data-search={results.mode}>
        {!found.length && (
          <Landing
            key={results.key}
            className="text-sm font-medium text-ink-muted"
          >
            No Memories Match
          </Landing>
        )}
        <ResultWall
          label="Filtered Memories"
          found={found}
          direct={false}
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
      <section aria-labelledby={`${headings}-direct`}>
        <h2
          id={`${headings}-direct`}
          tabIndex={-1}
          className="mb-3 text-sm font-medium text-ink outline-none"
        >
          {results.direct.length ? "Direct Matches" : "No Direct Matches"}
        </h2>
        {results.direct.length > 0 ? (
          <ResultWall
            label="Direct Matches"
            found={results.direct}
            direct
            glideKey={results.key}
            query={query}
            onOpen={onOpen}
            tiles={tiles}
            handle={direct}
            // Down from the bottom tile goes on to the Related Matches.
            onEdge={(key) => {
              if (key !== "ArrowDown" || !results.related.length) return;
              related.current?.focus("first");
              return results.related[0]!.id;
            }}
          />
        ) : (
          <Narrow
            found={results.related}
            chips={chips}
            // The chip that was pressed goes, so focus waits on the heading.
            onChips={(next) => {
              document.getElementById(`${headings}-direct`)?.focus();
              onChips(next);
            }}
          />
        )}
      </section>
      {results.related.length > 0 && (
        <section
          aria-labelledby={`${headings}-related`}
          className="mt-8 border-t border-line pt-6"
        >
          <h2
            id={`${headings}-related`}
            className="mb-3 text-sm font-medium text-ink-muted"
          >
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
            handle={related}
            onEdge={(key) => {
              if (key !== "ArrowUp" || !results.direct.length) return;
              direct.current?.focus("last");
              return results.direct.at(-1)!.id;
            }}
          />
        </section>
      )}
    </div>
  );
}

/**
 * With no Direct Match, the ways to narrow what was found: the kinds and
 * Categories among the Related Matches, as the same filter chips the
 * sidebar has (`narrowing`: nothing that narrows nothing).
 */
function Narrow({
  found,
  chips,
  onChips,
}: {
  found: Found[];
  chips: SearchChips;
  onChips: (chips: SearchChips) => void;
}) {
  const options = narrowing(found, chips);
  if (!options.kinds.length && !options.categories.length) return null;
  return (
    <div
      role="group"
      aria-label="Narrow Related Matches"
      className="flex flex-wrap gap-2"
    >
      {options.kinds.map((kind) => (
        <FilterChip key={kind} onClick={() => onChips({ ...chips, kind })}>
          {KIND_LABELS[kind]}
        </FilterChip>
      ))}
      {options.categories.map((category) => (
        <FilterChip
          key={category}
          onClick={() => onChips({ ...chips, category })}
        >
          {category}
        </FilterChip>
      ))}
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
