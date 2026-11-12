import { Fragment, type ReactNode } from "react";
import { IndexBadge } from "./index-state";
import { RotateCwIcon, Trash2Icon } from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { sourceHost } from "@spark/core";
import { cn } from "@spark/ui";
import type { UploadState } from "./image-capture";
import type { WallMemory } from "./use-library";

// Masonry places tiles before they render, so a tile's height is worked out
// from its text at the column's width: padding, up to 3 title lines, then
// whole lines of text up to MAX_LINES. Character widths lean wide (wide
// scripts count double), so text gets a line too many rather than one cut.
// Sizes in px at a 16px root; scaled by the root font size, so a larger
// browser text size keeps whole lines.
const PADDING = 32;
const GAP = 8;
const TITLE = { charWidth: 9.6, lineHeight: 26, maxLines: 3 };
const BODY = { charWidth: 7, lineHeight: 20 };
const MAX_LINES = 12;

let remScale: number | undefined;
const rem = () =>
  (remScale ??=
    parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1);

/** A tile's text: runs of blank lines fold into one, so no tile is mostly empty. */
export const tileText = (body: string | null) =>
  (body ?? "").replace(/\n\s*\n(\s*\n)+/g, "\n\n");
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/gu;

function lineCount(text: string, charsPerLine: number) {
  const per = Math.max(1, charsPerLine);
  return text.split("\n").reduce((n, line) => {
    const chars = line.length + (line.match(WIDE)?.length ?? 0);
    return n + Math.max(1, Math.ceil(chars / per));
  }, 0);
}

/** How a text tile lays out at `width`: its title and text lines, and its height. */
export function tileLayout(memory: WallMemory, width: number) {
  const k = rem();
  const inner = Math.max(1, width - PADDING * k);
  const title = memory.title
    ? Math.min(
        TITLE.maxLines,
        lineCount(memory.title, Math.floor(inner / (TITLE.charWidth * k)))
      )
    : 0;
  const body = Math.min(
    MAX_LINES - title,
    lineCount(tileText(memory.body), Math.floor(inner / (BODY.charWidth * k)))
  );
  const height =
    k *
    (PADDING +
      title * TITLE.lineHeight +
      (title ? GAP : 0) +
      body * BODY.lineHeight);
  return { title, body, height };
}

const LINK = { maxTextLines: 4, footer: 24 };

/** A link's Source host, as people say it (no `www.`). */
export const hostOf = (memory: Pick<WallMemory, "sourceUrl">) =>
  memory.sourceUrl ? (sourceHost(memory.sourceUrl) ?? memory.sourceUrl) : "";

/** What a link tile says under its title: the page's description, else the start of its text. */
const linkText = (memory: WallMemory) =>
  memory.description || memory.body?.split("\n")[0]?.slice(0, 400) || "";

/** How a link tile lays out at `width`: name, a few lines of text, then the Source line. */
export function linkLayout(memory: WallMemory, width: number) {
  const k = rem();
  const inner = Math.max(1, width - PADDING * k);
  const title = Math.min(
    TITLE.maxLines,
    lineCount(memoryName(memory), Math.floor(inner / (TITLE.charWidth * k)))
  );
  const text = linkText(memory);
  const body = text
    ? Math.min(
        LINK.maxTextLines,
        lineCount(text, Math.floor(inner / (BODY.charWidth * k)))
      )
    : 0;
  const height =
    k *
    (PADDING +
      title * TITLE.lineHeight +
      (body ? GAP + body * BODY.lineHeight : 0) +
      GAP +
      LINK.footer);
  return { title, body, text, height };
}

/** Very tall or wide images are cropped on the wall, never in the viewer. */
const ASPECT = { min: 0.4, max: 2.5 };

/** A tile's height at `width`: an image keeps its shape, text fits its lines. */
export function tileHeight(memory: WallMemory, width: number) {
  if (memory.kind === "link" || memory.kind === "video")
    return linkLayout(memory, width).height;
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
  if (memory.kind === "link" || memory.kind === "video") {
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
  if (memory.indexState === "failed") return `${name}, Indexing Failed`;
  if (isReferenceOnly(memory)) return `${name}, Reference Only`;
  return name;
}

/** One Memory on the wall, landing with DESIGN.md's Capture motion. */
export function MemoryTile(props: {
  memory: WallMemory;
  query: string;
  width: number;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onDelete: (memory: WallMemory) => void;
  onRetryIndexing: (memory: WallMemory) => void;
}) {
  const { memory } = props;
  // Inside the tile's frame, so it moves with the tile on press.
  const badge = !memory.upload && (
    <IndexBadge
      memory={memory}
      onRetry={() => props.onRetryIndexing(memory)}
      // One tab stop per wall: the keyboard retries from Memory detail.
      focusable={false}
      plate={!!memory.image}
      className="absolute right-2 bottom-2"
    />
  );
  return (
    <div className={cn("h-full w-full", memory.fresh && "spark-capture-in")}>
      {memory.kind === "link" || memory.kind === "video" ? (
        <LinkTile {...props} />
      ) : memory.image ? (
        <ImageTile {...props} badge={badge} />
      ) : (
        <TextTile {...props} badge={badge} />
      )}
    </div>
  );
}

const tileFrame =
  "relative h-full overflow-hidden rounded-tile transition-[transform,background-color] duration-(--duration-press) ease-out group-active:scale-[0.98] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--edge)]";

/** An image Memory: its thumbnail over its ThumbHash, and its upload while it lasts. */
function ImageTile({
  memory,
  onRetry,
  onBroken,
  onDelete,
  badge,
}: {
  memory: WallMemory;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onDelete: (memory: WallMemory) => void;
  badge: ReactNode;
}) {
  const image = memory.image!;
  const placeholder = placeholderUrl(image.thumbhash);
  // A stranded upload may have no thumbnail stored: its ThumbHash stands in.
  const stranded = memory.upload?.step === "stranded";
  return (
    <figure className="group h-full cursor-pointer">
      <div
        className={cn(tileFrame, "bg-sunken bg-cover bg-center")}
        style={placeholder ? { backgroundImage: `url(${placeholder})` } : {}}
      >
        {!stranded && (
          <img
            src={image.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => onBroken(memory.id)}
            className={cn(
              "h-full w-full object-cover",
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
        {badge}
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

/**
 * A link Memory: its name over its description, and a last line with its
 * Source and, while it lasts, its Index state or Reference Only. The last
 * line is always there, so a badge coming or going never moves the wall.
 */
function LinkTile({
  memory,
  query,
  width,
  onRetryIndexing,
}: {
  memory: WallMemory;
  query: string;
  width: number;
  onRetryIndexing: (memory: WallMemory) => void;
}) {
  const layout = linkLayout(memory, width);
  const name = memoryName(memory);
  const host = hostOf(memory);
  return (
    <figure className="group h-full cursor-pointer">
      <div
        className={cn(
          tileFrame,
          "flex flex-col gap-2 bg-sunken p-4 hover:bg-[color-mix(in_oklab,var(--sunken),var(--ink)_4%)]"
        )}
      >
        <p
          className="shrink-0 overflow-hidden font-display text-md leading-[26px] font-medium break-words text-ink [display:-webkit-box] [-webkit-box-orient:vertical]"
          style={{ WebkitLineClamp: layout.title }}
          dir="auto"
        >
          <Highlighted text={name} query={query} />
        </p>
        {layout.body > 0 && (
          <p
            className="shrink-0 overflow-hidden text-sm break-words text-ink-muted [display:-webkit-box] [-webkit-box-orient:vertical]"
            style={{ WebkitLineClamp: layout.body }}
            dir="auto"
          >
            <Highlighted text={layout.text} query={query} />
          </p>
        )}
        <div className="mt-auto flex h-6 shrink-0 items-center justify-between gap-2">
          <span
            className="min-w-0 truncate text-xs text-ink-muted"
            dir="ltr"
            translate="no"
          >
            {host !== name && <Highlighted text={host} query={query} />}
          </span>
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
      </div>
    </figure>
  );
}

/** A text Memory: its title over its text, search words marked. */
function TextTile({
  memory,
  query,
  width,
  badge,
}: {
  memory: WallMemory;
  query: string;
  width: number;
  badge: ReactNode;
}) {
  const layout = tileLayout(memory, width);
  // While a badge shows, the last line makes room for it; the height stays,
  // so nothing on the wall moves when Indexing finishes.
  const badged = !!badge && memory.indexState !== "searchable";
  const bodyLines = badged && layout.body > 1 ? layout.body - 1 : layout.body;
  return (
    <figure className="group h-full cursor-pointer">
      <div
        className={cn(
          tileFrame,
          "flex flex-col gap-2 bg-sunken p-4 hover:bg-[color-mix(in_oklab,var(--sunken),var(--ink)_4%)]"
        )}
      >
        {memory.title && (
          <p
            className="shrink-0 overflow-hidden font-display text-md leading-[26px] font-medium break-words text-ink [display:-webkit-box] [-webkit-box-orient:vertical]"
            style={{ WebkitLineClamp: layout.title }}
            dir="auto"
          >
            <Highlighted text={memory.title} query={query} />
          </p>
        )}
        <p
          className={cn(
            "overflow-hidden text-sm break-words whitespace-pre-line [display:-webkit-box] [-webkit-box-orient:vertical]",
            memory.title ? "text-ink-muted" : "text-ink",
            // A single line keeps clear of the badge (pinned right, even in RTL).
            badged && bodyLines === layout.body && "pr-24"
          )}
          style={{ WebkitLineClamp: bodyLines }}
          dir="auto"
        >
          <Highlighted
            text={tileText(memory.body).slice(0, 800)}
            query={query}
          />
        </p>
        {badge}
      </div>
    </figure>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with each query word marked where a word starts with it. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${words.map(escape).join("|")})`,
    "giu"
  );
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
