import { rootFontScale } from "./root-font-scale";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { IndexBadge, isPartly, PartlyIndexedBadge } from "./index-state";
import {
  AtSignIcon,
  FileTextIcon,
  ImageIcon,
  Link2Icon,
  PlayIcon,
  RotateCwIcon,
  StickyNoteIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { formatTimestamp, sourceHost } from "@spark/core";
import { Checkbox, cn, type MasonrySelection } from "@spark/ui";
import type { UploadState } from "./image-capture";
import { bodyLines, titleLines } from "./title-lines";
import type { WallMemory } from "./use-library";

// Masonry places tiles before they render, so a tile's height is worked out
// from its text at the column width. Body lines use the browser's own font
// shaping and whitespace rules, cached until fonts, width or text size change.
const GAP = 8;
const BODY = { lineHeight: 20 };
const MAX_LINES = 12;

/** A tile narrower than this sits in a phone's two lanes: 12px padding, a smaller title. */
const COMPACT = 200;
const isCompact = (width: number) => width < COMPACT;
const padding = (width: number) => (isCompact(width) ? 12 : 16);
/** The title's size and line height in px: `text-md`, or `text-base` on a phone lane. */
const titleFont = (width: number) =>
  isCompact(width)
    ? { size: 15, lineHeight: 24 }
    : { size: 17, lineHeight: 26 };

/** A tile's text: runs of blank lines fold into one, so no tile is mostly empty. */
export const tileText = (body: string | null) =>
  (body ?? "").replace(/\n\s*\n(\s*\n)+/g, "\n\n");
/** Whether the text tile actually renders a badge. */
const textBadge = (memory: WallMemory) =>
  memory.sample ||
  (!memory.upload && (isPartly(memory) || memory.indexState !== "searchable"));

/** How a text tile lays out at `width`: its title and text lines, and its height. */
export function tileLayout(memory: WallMemory, width: number, precise = true) {
  const k = rootFontScale();
  const pad = padding(width);
  const inner = Math.max(1, width - 2 * pad * k);
  const font = titleFont(width);
  const title = memory.title
    ? precise
      ? titleLines(memory.title, inner, font.size)
      : estimatedLines(memory.title, inner / k, font.size, 2)
    : 0;
  const text = tileText(memory.body).slice(0, 800);
  const body = precise
    ? bodyLines(text, inner, MAX_LINES - title)
    : estimatedLines(text, inner / k, 13, MAX_LINES - title);
  const height =
    k *
    (2 * pad +
      title * font.lineHeight +
      (title ? GAP : 0) +
      body * BODY.lineHeight +
      (textBadge(memory) ? GAP + 24 : 0));
  return { title, body, height };
}

const LINK = { maxTextLines: 4, source: 16, badge: 24 };

/** A link's Source host, as people say it (no `www.`). */
export const hostOf = (memory: Pick<WallMemory, "sourceUrl">) =>
  memory.sourceUrl ? (sourceHost(memory.sourceUrl) ?? memory.sourceUrl) : "";

/** What a link tile says under its title: the page's description, else the start of its text. */
const linkText = (memory: WallMemory) =>
  memory.description ||
  (memory.kind === "social_post"
    ? (memory.body ?? "").replace(/\s+/g, " ").trim().slice(0, 400)
    : memory.body?.split("\n")[0]?.slice(0, 400)) ||
  "";

/** Whether a tile is a link's: a page, a video or a social post, shown by its Source. */
export const isLinkTile = (memory: Pick<WallMemory, "kind">) =>
  memory.kind === "link" ||
  memory.kind === "video" ||
  memory.kind === "social_post";

/** A link tile's badge line shows only while there is something to say: Reference Only, or an Index state. */
const linkBadge = (memory: WallMemory) =>
  isReferenceOnly(memory) || memory.indexState !== "searchable";

/** How a link tile lays out at `width`: name, a few lines of text, the Source line, a badge line while one shows. */
export function linkLayout(memory: WallMemory, width: number, precise = true) {
  const k = rootFontScale();
  const pad = padding(width);
  const inner = Math.max(1, width - 2 * pad * k);
  const font = titleFont(width);
  const title = precise
    ? titleLines(memoryName(memory), inner, font.size)
    : estimatedLines(memoryName(memory), inner / k, font.size, 2);
  const text = linkText(memory);
  const body = text
    ? Math.min(
        LINK.maxTextLines,
        precise
          ? bodyLines(text, inner, LINK.maxTextLines, false)
          : estimatedLines(
              text.replace(/\s+/g, " "),
              inner / k,
              13,
              LINK.maxTextLines
            )
      )
    : 0;
  const badge = linkBadge(memory);
  const height =
    k *
    (2 * pad +
      title * font.lineHeight +
      (body ? GAP + body * BODY.lineHeight : 0) +
      12 +
      LINK.source +
      (badge ? GAP + LINK.badge : 0));
  return { title, body, text, badge, height };
}

/** Very tall or wide images are cropped on the wall, never in the viewer. */
const ASPECT = { min: 0.4, max: 2.5 };

/** No canvas, font lookup or word segmentation on the full-wall layout path. */
const estimatedLines = (
  text: string,
  width: number,
  size: number,
  max: number
) =>
  Math.min(
    max,
    text
      .split("\n")
      .reduce(
        (lines, paragraph) =>
          lines +
          Math.max(
            1,
            Math.ceil((paragraph.length * size * 0.55) / Math.max(1, width))
          ),
        0
      )
  );

export function estimateTileHeight(memory: WallMemory, width: number) {
  if (isLinkTile(memory)) return linkLayout(memory, width, false).height;
  if (memory.image) return tileHeight(memory, width);
  return tileLayout(memory, width, false).height;
}

/** A tile's height at `width`: an image keeps its shape, text fits its lines. */
export function tileHeight(memory: WallMemory, width: number) {
  if (isLinkTile(memory)) return linkLayout(memory, width).height;
  if (!memory.image) return tileLayout(memory, width).height;
  const { width: w, height: h } = memory.image;
  return width * Math.min(ASPECT.max, Math.max(ASPECT.min, h / w));
}

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The name a Memory goes by: its title, else the start of its text, else
 * (an image before Indexing names it) "Image" and its Capture day.
 */
export function memoryName(memory: WallMemory) {
  if (memory.kind === "image" || memory.kind === "pdf") {
    return (
      memory.title ||
      memory.indexTitle ||
      `${memory.kind === "pdf" ? "PDF" : "Image"}, ${day.format(new Date(memory.capturedAt))}`
    );
  }
  if (isLinkTile(memory)) {
    return (
      memory.title || memory.pageTitle || memory.indexTitle || hostOf(memory)
    );
  }
  return memory.title || memory.body?.split("\n")[0]?.slice(0, 120) || "";
}

/** A link that kept no Preserved copy, once Indexing is done saying so. */
export const isReferenceOnly = (memory: WallMemory) =>
  (memory.kind === "link" || memory.kind === "video") &&
  memory.preservation === "reference_only" &&
  memory.indexState === "searchable";

/** A tile's accessible name: its Memory's, then its upload or Index state while they last. */
export function tileLabel(memory: WallMemory) {
  const name =
    memory.kind === "pdf" && memory.title
      ? `${memoryName(memory)}, PDF`
      : memoryName(memory);
  if (memory.upload) {
    return `${name}, ${memory.upload.step === "sending" ? "Uploading" : "Failed"}`;
  }
  if (memory.indexState === "indexing") return `${name}, Indexing`;
  if (isPartly(memory)) return `${name}, Partly Indexed`;
  if (memory.indexState === "failed") return `${name}, Indexing Failed`;
  if (isReferenceOnly(memory)) return `${name}, Reference Only`;
  return memory.sample ? `${name}, Sample` : name;
}

/**
 * One Memory on the wall. A new tile's entrance belongs to the wall (Masonry
 * `data-enter`), not the tile. `footer` is a result's why-chip, inside the
 * tile's frame so the ring and the outline wrap one shape.
 */
export function MemoryTile(props: {
  memory: WallMemory;
  selection?: MasonrySelection;
  query: string;
  width: number;
  footer?: ReactNode;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onDelete: (memory: WallMemory) => void;
  onRetryIndexing: (memory: WallMemory) => void;
}) {
  const { memory, selection, ...rest } = props;
  // Inside the tile's frame, so it moves with the tile on press.
  const badge = memory.sample ? (
    <span className="rounded-chip bg-surface px-2 py-1 text-xs text-ink-muted">
      Sample
    </span>
  ) : (
    !memory.upload &&
    (isPartly(memory) ? (
      <PartlyIndexedBadge />
    ) : (
      <IndexBadge
        memory={memory}
        onRetry={() => props.onRetryIndexing(memory)}
        // One tab stop per wall: the keyboard retries from Memory detail.
        focusable={false}
        plate={!!memory.image}
      />
    ))
  );
  const tile = { ...rest, memory };
  return (
    <div className="hover-raise relative h-full w-full rounded-tile">
      {selection && (
        // Over the tile's top-right corner, on a plate that fades in with the
        // tile's hover; a touch tap on the corner only counts while selecting.
        <span className="check-plate absolute top-2 right-2 z-10 grid size-7 place-items-center pointer-coarse:pointer-events-none pointer-coarse:[[data-selection-active=true]_&]:pointer-events-auto">
          <Checkbox
            aria-label={`Select ${tileLabel(memory)}`}
            tabIndex={-1}
            checked={selection.ids.includes(memory.id)}
            onCheckedChange={() => selection.choose(memory.id, "toggle")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.shiftKey) {
                event.preventDefault();
                selection.choose(memory.id, "range");
              }
            }}
          />
        </span>
      )}
      {isLinkTile(memory) ? (
        <LinkTile {...tile} />
      ) : memory.image ? (
        <ImageTile {...tile} badge={badge} />
      ) : (
        <TextTile {...tile} badge={badge} />
      )}
    </div>
  );
}

const tileFrame =
  "relative flex h-full flex-col rounded-tile transition-[scale,background-color] duration-(--duration-press) ease-out group-active:scale-[0.98] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--edge)]";

/** A text or link tile: the page's own surface with the faint outline; hover sinks it. */
const flatSurface =
  "overflow-hidden bg-canvas hover:bg-sunken dark:bg-surface dark:hover:bg-sunken";

/** The fixed 36px footer of a result tile, holding its why-chip. */
function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-t border-line bg-surface px-2">
      {children}
    </div>
  );
}

/** An image Memory: its thumbnail over its ThumbHash, and its upload while it lasts. */
function ImageTile({
  memory,
  footer,
  onRetry,
  onBroken,
  onDelete,
  badge,
}: {
  memory: WallMemory;
  width: number;
  footer?: ReactNode;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onDelete: (memory: WallMemory) => void;
  badge: ReactNode;
}) {
  const image = memory.image!;
  const placeholder = placeholderUrl(image.thumbhash);
  // A stranded upload may have no thumbnail stored: its ThumbHash stands in.
  const stranded = memory.upload?.step === "stranded";
  // An image that still will not load leaves the placeholder, not a broken glyph.
  const [unreadable, setUnreadable] = useState(false);
  // It fades in over the ThumbHash as it arrives; one already in the cache
  // (complete when the tile mounts) is simply there.
  const [shown, setShown] = useState(false);
  const [fade, setFade] = useState(true);
  const arrived = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setFade(false);
      setShown(true);
    }
  }, []);
  return (
    <figure className="group h-full cursor-pointer">
      {/* The frame clips to the tile's radius, so the footer strip's bottom
          corners follow the outline; the focus ring sits outside, on the wall's item. */}
      <div className={cn(tileFrame, "overflow-hidden")}>
        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden bg-sunken bg-cover bg-center",
            footer ? "rounded-t-[inherit]" : "rounded-[inherit]"
          )}
          style={placeholder ? { backgroundImage: `url(${placeholder})` } : {}}
        >
          {!stranded && (
            <img
              ref={arrived}
              src={image.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              data-pdf={memory.kind === "pdf" || undefined}
              onError={() => {
                setUnreadable(true);
                onBroken(memory.id);
              }}
              onLoad={() => {
                setUnreadable(false);
                setShown(true);
              }}
              className={cn(
                "h-full w-full object-cover",
                fade &&
                  "transition-opacity duration-(--duration-preview) ease-out",
                !shown && "opacity-0",
                unreadable && "invisible",
                // Screenshots read top down: crop the bottom.
                image.height / image.width > ASPECT.max && "object-top"
              )}
            />
          )}
          {memory.kind === "pdf" && <KindPlate>PDF</KindPlate>}
          {memory.upload && (
            <UploadBadge
              upload={memory.upload}
              onRetry={() => onRetry(memory.id)}
              onDelete={() => onDelete(memory)}
              // One tab stop per wall: the keyboard retries from the viewer.
              focusable={false}
              className="absolute right-2 bottom-2"
            />
          )}
          {badge && <div className="absolute right-2 bottom-2">{badge}</div>}
        </div>
        {footer && <Footer>{footer}</Footer>}
      </div>
    </figure>
  );
}

/**
 * What a tile's image is when the image alone does not say: a PDF. The
 * fixed ink plate badges over imagery use (DESIGN.md → Colour).
 */
function KindPlate({ children }: { children: string }) {
  return (
    <span
      data-theme="dark"
      aria-hidden
      className="absolute bottom-2 left-2 inline-flex h-6 items-center rounded-chip bg-canvas/80 px-1.5 text-2xs font-medium text-ink"
    >
      {children}
    </span>
  );
}

/**
 * Preservation while it is not yet Preserved: upload progress, or Failed
 * with Try Again (or Delete, when the file is no longer in hand, after a
 * reload). A fixed ink plate in both themes, since the image under it
 * ignores the theme (DESIGN.md → Colour): the dark theme's tokens.
 */
export function UploadBadge({
  upload,
  onRetry,
  onDelete,
  focusable = true,
  className,
}: {
  upload: UploadState;
  onRetry: () => void;
  onDelete: () => void;
  focusable?: boolean;
  className?: string;
}) {
  const plate =
    "inline-flex h-7 items-center gap-1.5 rounded-chip bg-canvas/80 px-2 text-xs font-medium text-ink tabular";
  if (upload.step !== "sending") {
    const stranded = upload.step === "stranded";
    const Icon = stranded ? Trash2Icon : RotateCwIcon;
    return (
      <span data-theme="dark" className={cn(plate, "pr-1", className)}>
        Failed
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (stranded) onDelete();
            else onRetry();
          }}
          // Keep Enter and Space from also opening the Memory.
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={stranded ? "Delete" : "Try Again"}
          tabIndex={focusable ? undefined : -1}
          className="relative grid size-5 place-items-center rounded-[4px] hover:bg-surface before:absolute before:-inset-2.5"
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      </span>
    );
  }
  const percent = Math.round(upload.progress * 100);
  return (
    <span
      data-theme="dark"
      role="progressbar"
      aria-label="Uploading"
      aria-valuenow={percent}
      className={cn(plate, "w-7 justify-center px-0", className)}
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - Math.max(4, percent)}
          className="transition-[stroke-dashoffset] duration-(--duration-small) ease-out"
        />
      </svg>
    </span>
  );
}

/**
 * "Reference Only" (GLOSSARY.md → Preservation): a link Spark kept no copy
 * of. Quiet text, not a chip: many links are, and the wall stays calm.
 */
export function ReferenceOnlyBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs whitespace-nowrap text-ink-muted",
        className
      )}
    >
      Reference Only
    </span>
  );
}

/** One mark per kind: before a link's Source, and at the start of a ⌘K row. */
export const KIND_ICONS: Record<string, LucideIcon> = {
  image: ImageIcon,
  pdf: FileTextIcon,
  video: PlayIcon,
  link: Link2Icon,
  social_post: AtSignIcon,
  text: StickyNoteIcon,
};

/** The kind mark before a link's Source: a page, a video or a post. */
const SourceMark = ({ kind }: Pick<WallMemory, "kind">) => {
  const Icon = KIND_ICONS[kind] ?? Link2Icon;
  return <Icon className="size-4 shrink-0" aria-hidden />;
};

/** A title, clamped to the lines it was measured to take. */
function TileTitle({
  text,
  lines,
  query,
  width,
}: {
  text: string;
  lines: number;
  query: string;
  width: number;
}) {
  return (
    <p
      className={cn(
        "shrink-0 overflow-hidden font-display font-medium text-ink text-pretty wrap-anywhere [display:-webkit-box] [-webkit-box-orient:vertical]",
        isCompact(width) ? "text-base leading-6" : "text-md leading-[1.625rem]"
      )}
      style={{ WebkitLineClamp: lines }}
      title={text}
      dir="auto"
    >
      <Highlighted text={text} query={query} />
    </p>
  );
}

/**
 * A link Memory: its name over its description, then its Source with a mark
 * for the kind and, only while one shows, a line with its Index state or
 * Reference Only. It is as tall as what it says.
 */
function LinkTile({
  memory,
  query,
  width,
  footer,
  onRetryIndexing,
}: {
  memory: WallMemory;
  query: string;
  width: number;
  footer?: ReactNode;
  onRetryIndexing: (memory: WallMemory) => void;
}) {
  const layout = linkLayout(memory, width);
  const name = memoryName(memory);
  const host = hostOf(memory);
  const duration = memory.kind === "video" && memory.video?.duration;
  return (
    <figure className="group h-full cursor-pointer">
      <div className={cn(tileFrame, flatSurface)}>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isCompact(width) ? "p-3" : "p-4"
          )}
        >
          <TileTitle
            text={name}
            lines={layout.title}
            query={query}
            width={width}
          />
          {layout.body > 0 && (
            <p
              className="mt-2 shrink-0 overflow-hidden text-sm break-words text-ink-muted [display:-webkit-box] [-webkit-box-orient:vertical]"
              style={{ WebkitLineClamp: layout.body }}
              dir="auto"
            >
              <Highlighted text={layout.text} query={query} />
            </p>
          )}
          <span className="mt-3 flex h-4 w-full shrink-0 items-center gap-1 text-xs text-ink-muted">
            <SourceMark kind={memory.kind} />
            <span className="truncate" dir="ltr" translate="no">
              {host !== name && <Highlighted text={host} query={query} />}
            </span>
            {duration && Number.isFinite(duration) && duration > 0 ? (
              <span
                data-theme="dark"
                className="ml-auto shrink-0 rounded-chip bg-canvas px-1.5 text-xs text-ink tabular-nums"
              >
                {formatTimestamp(duration)}
              </span>
            ) : null}
          </span>
          {layout.badge && (
            <div className="mt-2 flex h-6 shrink-0 items-center">
              {isReferenceOnly(memory) ? (
                <ReferenceOnlyBadge />
              ) : (
                <IndexBadge
                  memory={memory}
                  onRetry={() => onRetryIndexing(memory)}
                  // One tab stop per wall: the keyboard retries from Memory detail.
                  focusable={false}
                  className="shrink-0"
                />
              )}
            </div>
          )}
        </div>
        {footer && <Footer>{footer}</Footer>}
      </div>
    </figure>
  );
}

/** A text Memory: its title over its text, search words marked. */
function TextTile({
  memory,
  query,
  width,
  footer,
  badge,
}: {
  memory: WallMemory;
  query: string;
  width: number;
  footer?: ReactNode;
  badge: ReactNode;
}) {
  const layout = tileLayout(memory, width);
  // While a badge shows, the last line makes room for it; the height stays,
  // so nothing on the wall moves when Indexing finishes.
  const bodyLines = layout.body;
  return (
    <figure className="group h-full cursor-pointer">
      <div className={cn(tileFrame, flatSurface)}>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2",
            isCompact(width) ? "p-3" : "p-4"
          )}
        >
          {memory.title && (
            <TileTitle
              text={memory.title}
              lines={layout.title}
              query={query}
              width={width}
            />
          )}
          <p
            className="shrink-0 overflow-hidden text-sm break-words whitespace-pre-line text-ink [display:-webkit-box] [-webkit-box-orient:vertical]"
            style={{ WebkitLineClamp: bodyLines }}
            dir="auto"
          >
            <Highlighted
              text={tileText(memory.body).slice(0, 800)}
              query={query}
            />
          </p>
          {textBadge(memory) && (
            <div className="flex shrink-0 justify-end">{badge}</div>
          )}
        </div>
        {footer && <Footer>{footer}</Footer>}
      </div>
    </figure>
  );
}

/** The same word-prefix terms drive highlights and visible passage evidence. */
const highlightTerms = (query: string) => [
  ...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1)
  ),
];
const highlightPattern = (terms: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join("|")})`, "giu");

export function passageIsHighlighted(text: string, query: string) {
  const terms = highlightTerms(query);
  return (
    terms.length > 0 &&
    terms.every((term) => highlightPattern([term]).test(text))
  );
}

/** `text` with each query word marked where a word starts with it. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const words = highlightTerms(query);
  if (!words.length) return <>{text}</>;
  const re = highlightPattern(words);
  return (
    <>
      {text
        .split(re)
        .map((part, i) =>
          i % 2 ? (
            <mark key={i}>{part}</mark>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          )
        )}
    </>
  );
}
