import { CategoryEditor, type CategoryEdit } from "./categories";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowUpRightIcon, Trash2Icon } from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { isPartlyIndexed } from "@spark/core";
import { Button, Dialog, DialogContent, DialogTitle, cn } from "@spark/ui";
import { api } from "../api";
import { AiOptOutSwitch, IndexBadge, type IndexingProps } from "./index-state";
import { memoryName, UploadBadge } from "./memory-tile";
import type { PdfMatch } from "./pdf-match";
import type { WallMemory } from "./use-library";
import { MoreLikeThis } from "./why";

/** A page image as the viewer shows it. */
type Page = { page: number; url: string; width: number; height: number };

type Pages = Page[] | "loading" | "failed";

/**
 * A stored PDF's page images, signed for a while. `reload` asks again (an
 * expired URL, a failed fetch). Nothing is asked while it uploads.
 */
function usePages(memory: WallMemory) {
  const [attempt, setAttempt] = useState(0);
  // The answer, and the request (Memory and attempt) it answers.
  const [answer, setAnswer] = useState<{ to: string; pages: Pages }>();
  const uploading = !!memory.upload;
  const request = `${memory.id}:${attempt}`;
  useEffect(() => {
    if (uploading) return;
    const abort = new AbortController();
    const settle = (pages: Pages) =>
      !abort.signal.aborted && setAnswer({ to: request, pages });
    api.api.memories[":id"].pages
      .$get({ param: { id: memory.id } }, { init: { signal: abort.signal } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        settle(((await res.json()) as { pages: Page[] }).pages);
      })
      .catch(() => settle("failed"));
    return () => abort.abort();
  }, [memory.id, uploading, request]);
  const pages: Pages = answer?.to === request ? answer.pages : "loading";
  return { pages, reload: () => setAttempt((n) => n + 1) };
}

/**
 * The PDF viewer: a PDF Memory's Indexed pages, one under another, opened
 * at the page that matched, the matched passage marked above it. ← →
 * go a page back or on; ↑ ↓ and Space scroll. Always dark, like the image
 * viewer, so the pages set the tone. Open PDF shows the whole file.
 */
export function PdfViewer({
  memory,
  match,
  onClose,
  onDelete,
  onRetry,
  onRetryIndexing,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
}: {
  memory: WallMemory | undefined;
  match: PdfMatch;
  onClose: () => void;
  onDelete: (memory: WallMemory) => void;
  onRetry: (id: string) => void;
  onMoreLikeThis: (memory: WallMemory) => void;
} & IndexingProps & { onCategories?: CategoryEdit }) {
  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <Viewer
          key={memory.id}
          memory={memory}
          match={match}
          onClose={onClose}
          onDelete={onDelete}
          onRetry={onRetry}
          onRetryIndexing={onRetryIndexing}
          onCategories={onCategories}
          onAiOptOut={onAiOptOut}
          onMoreLikeThis={onMoreLikeThis}
        />
      )}
    </Dialog>
  );
}

function Viewer({
  memory,
  match,
  onClose,
  onDelete,
  onRetry,
  onRetryIndexing,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
}: {
  memory: WallMemory;
  match: PdfMatch;
  onClose: () => void;
  onDelete: (memory: WallMemory) => void;
  onRetry: (id: string) => void;
  onMoreLikeThis: (memory: WallMemory) => void;
} & IndexingProps & { onCategories?: CategoryEdit }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { pages, reload } = usePages(memory);
  // Signed URLs expire: a page that fails asks for new ones, once.
  const renewed = useRef(false);
  const renew = () => {
    if (renewed.current) return;
    renewed.current = true;
    reload();
  };
  const shown = Array.isArray(pages) ? pages : undefined;
  const stranded = memory.upload?.step === "stranded";

  useOpenAt(scroller, shown, match.page);

  const go = (step: -1 | 1) => {
    const box = scroller.current;
    if (!box || !shown) return;
    const tops = shown.map((p) =>
      box.querySelector<HTMLElement>(`[data-page="${p.page}"]`)!
    );
    // The page at the top of the view (within the gap above it), then its neighbour.
    const line = box.scrollTop + 24;
    const at = tops.findLastIndex((el) => el.offsetTop <= line);
    tops[Math.max(0, Math.min(tops.length - 1, at + step))]?.scrollIntoView({
      block: "start",
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
  };

  const remove = () => {
    onDelete(memory);
    onClose();
  };

  const partly =
    memory.indexState === "searchable" && isPartlyIndexed(memory.pages);

  return (
    <DialogContent
      data-theme="dark"
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
      // The pages take focus, so ↑ ↓ and Space scroll them at once.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        scroller.current?.focus({ preventScroll: true });
      }}
      className="h-dvh w-screen max-w-none overflow-hidden rounded-none bg-canvas shadow-none"
      closeClassName="z-10 size-11 bg-transparent"
    >
      <DialogTitle className="sr-only">{memoryName(memory)}</DialogTitle>
      {/* A solid strip, so pages never scroll under the controls. */}
      <div className="absolute inset-x-0 top-0 flex h-17 items-center gap-1 bg-canvas pr-14 pl-2 sm:gap-3 sm:pr-16 sm:pl-3">
        <div className="flex min-w-0 flex-1 items-center">
          {memory.upload ? (
            <UploadBadge
              upload={memory.upload}
              onRetry={() => onRetry(memory.id)}
              onDelete={remove}
              className="h-11"
            />
          ) : memory.indexState !== "searchable" ? (
            <IndexBadge
              memory={memory}
              onRetry={() => onRetryIndexing(memory)}
              withReason
            />
          ) : (
            partly && <PartlyIndexed className="max-sm:hidden" />
          )}
        </div>
        {!stranded && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <MoreLikeThis
              memory={memory}
              onSelect={onMoreLikeThis}
              compact
              className="h-11"
            />
            <CategoryEditor
              compact
              key={memory.id}
              memory={memory}
              onSave={onCategories}
            />
            <AiOptOutSwitch memory={memory} onChange={onAiOptOut} />
            {memory.image && !memory.upload && (
              <Button
                asChild
                variant="quiet"
                size="icon"
                className="size-11"
                aria-label="Open PDF"
              >
                <a href={memory.image.url} target="_blank" rel="noreferrer">
                  <ArrowUpRightIcon aria-hidden />
                </a>
              </Button>
            )}
            <Button
              variant="quiet"
              size="icon"
              aria-label="Delete"
              className="size-11"
              onClick={remove}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <div
        ref={scroller}
        // A tab stop too, so the keyboard can always come back to scrolling.
        tabIndex={0}
        aria-label="Pages"
        className="absolute inset-x-0 top-17 bottom-0 overflow-y-auto overscroll-contain px-4 pb-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:px-16"
      >
        <div className="mx-auto flex max-w-[50rem] flex-col gap-4">
          {shown ? (
            shown.map((page) => (
              <PageView
                key={page.page}
                page={page}
                passage={match.page === page.page ? match.passage : undefined}
                eager={page.page <= (match.page ?? 1) + 1}
                onBroken={renew}
              />
            ))
          ) : (
            <FirstPage memory={memory} stranded={stranded} />
          )}
          {pages === "failed" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-ink-muted">Pages Are Unreachable</p>
              <Button variant="outline" onClick={reload}>
                Try Again
              </Button>
            </div>
          )}
          {/* On a phone the strip has no room: it closes the pages instead. */}
          {shown && partly && (
            <PartlyIndexed className="self-center py-2 sm:hidden" />
          )}
        </div>
      </div>
    </DialogContent>
  );
}

/** Only the first pages of a long PDF were Indexed (the Free allowance). */
function PartlyIndexed({ className }: { className?: string }) {
  return (
    <span className={cn("text-sm whitespace-nowrap text-ink-muted", className)}>
      Partly Indexed
    </span>
  );
}

/** Scrolls to `page` once the pages are laid out (their sizes are known before they load). */
function useOpenAt(
  scroller: RefObject<HTMLDivElement | null>,
  pages: Page[] | undefined,
  page: number | undefined
) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !pages || !page || page === 1) return;
    done.current = true;
    scroller.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [scroller, pages, page]);
}

/** One page image at the column's width, its box sized before it loads. */
export function PageView({
  page,
  passage,
  eager,
  onBroken,
}: {
  page: Page;
  passage: string | undefined;
  eager: boolean;
  onBroken: () => void;
}) {
  // A page that still will not load leaves its empty sheet, not a broken glyph.
  const [unreadable, setUnreadable] = useState(false);
  return (
    <figure data-page={page.page} className="flex flex-col gap-3">
      {/* What matched comes first, so it is on screen when the page opens. */}
      {passage && (
        <figcaption
          dir="auto"
          className="line-clamp-6 rounded-tile bg-surface p-4 text-base text-ink"
        >
          <mark>{passage}</mark>
        </figcaption>
      )}
      <div
        // A page that will not load keeps its sheet and its label; only the
        // image hides.
        role={unreadable ? "img" : undefined}
        aria-label={unreadable ? `Page ${page.page}` : undefined}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        className="w-full overflow-hidden rounded-tile bg-surface"
      >
        <img
          src={page.url}
          alt={`Page ${page.page}`}
          width={page.width}
          height={page.height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => {
            setUnreadable(true);
            onBroken();
          }}
          onLoad={() => setUnreadable(false)}
          className={cn(
            "block size-full select-none",
            unreadable && "invisible"
          )}
        />
      </div>
    </figure>
  );
}

/** Until the pages arrive (or while it uploads), the first page's thumbnail stands in. */
function FirstPage({
  memory,
  stranded,
}: {
  memory: WallMemory;
  stranded: boolean;
}) {
  const image = memory.image;
  if (!image) return null;
  const placeholder = placeholderUrl(image.thumbhash);
  return (
    <div
      className="w-full overflow-hidden rounded-tile bg-cover bg-center"
      style={{
        aspectRatio: `${image.width} / ${image.height}`,
        backgroundImage: placeholder ? `url(${placeholder})` : undefined,
      }}
    >
      {!stranded && (
        <img
          src={image.thumbnailUrl}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
        />
      )}
    </div>
  );
}
