import { Fragment } from "react";
import { motion } from "motion/react";
import { RotateCwIcon } from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { cn } from "@spark/ui";
import { DURATION, EASING } from "@spark/ui/tokens";
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

/** Very tall or wide images are cropped on the wall, never in the viewer. */
const ASPECT = { min: 0.4, max: 2.5 };

/** A tile's height at `width`: an image keeps its shape, text fits its lines. */
export function tileHeight(memory: WallMemory, width: number) {
  if (!memory.image) return tileLayout(memory, width).height;
  const { width: w, height: h } = memory.image;
  return width * Math.min(ASPECT.max, Math.max(ASPECT.min, h / w));
}

/** The name a Memory goes by: its title, else the start of its text. */
export function memoryName(memory: WallMemory) {
  if (memory.kind === "image") return memory.title || "Image";
  return memory.title || memory.body?.split("\n")[0]?.slice(0, 120) || "";
}

/** One Memory on the wall, landing with DESIGN.md's Capture motion. */
export function MemoryTile(props: {
  memory: WallMemory;
  query: string;
  width: number;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
}) {
  return (
    <motion.div
      className="h-full w-full"
      // DESIGN.md → Motion: a new Capture fades and grows into place.
      initial={props.memory.fresh ? { opacity: 0, scale: 0.96 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: DURATION.panel / 1000, ease: EASING.out }}
    >
      {props.memory.image ? <ImageTile {...props} /> : <TextTile {...props} />}
    </motion.div>
  );
}

const tileFrame =
  "relative h-full overflow-hidden rounded-tile transition-[transform,background-color] duration-[120ms] ease-out group-active:scale-[0.98] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--edge)]";

/** An image Memory: its thumbnail over its ThumbHash, and its upload while it lasts. */
function ImageTile({
  memory,
  onRetry,
  onBroken,
}: {
  memory: WallMemory;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
}) {
  const image = memory.image!;
  const placeholder = placeholderUrl(image.thumbhash);
  return (
    <figure className="group h-full cursor-pointer">
      <div
        className={cn(tileFrame, "bg-sunken bg-cover bg-center")}
        style={placeholder ? { backgroundImage: `url(${placeholder})` } : {}}
      >
        <img
          src={image.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => onBroken(memory.id)}
          className="h-full w-full object-cover"
        />
        {memory.upload && (
          <UploadBadge
            upload={memory.upload}
            onRetry={() => onRetry(memory.id)}
            className="absolute right-2 bottom-2"
          />
        )}
      </div>
    </figure>
  );
}

/**
 * Preservation while it is not yet Preserved: upload progress, or Failed
 * with Try Again. A fixed ink plate, since the image under it ignores the
 * theme (DESIGN.md → Colour).
 */
export function UploadBadge({
  upload,
  onRetry,
  className,
}: {
  upload: UploadState;
  onRetry: () => void;
  className?: string;
}) {
  const plate =
    "inline-flex h-7 items-center gap-1.5 rounded-chip bg-[#111214]/80 px-2 text-xs font-medium text-[#fff] tabular";
  if (upload.step === "failed") {
    return (
      <span className={cn(plate, "pr-1", className)}>
        Failed
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          // Keep Enter and Space from also opening the Memory.
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Try Again"
          className="relative grid size-5 place-items-center rounded-[4px] hover:bg-[#fff]/15 before:absolute before:-inset-2.5"
        >
          <RotateCwIcon className="size-3.5" aria-hidden />
        </button>
      </span>
    );
  }
  const percent = Math.round(upload.progress * 100);
  return (
    <span
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
          stroke="#fff"
          strokeOpacity="0.3"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - Math.max(4, percent)}
          className="transition-[stroke-dashoffset] duration-[180ms] ease-out"
        />
      </svg>
    </span>
  );
}

/** A text Memory: its title over its text, search words marked. */
function TextTile({
  memory,
  query,
  width,
}: {
  memory: WallMemory;
  query: string;
  width: number;
}) {
  const layout = tileLayout(memory, width);
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
            memory.title ? "text-ink-muted" : "text-ink"
          )}
          style={{ WebkitLineClamp: layout.body }}
          dir="auto"
        >
          <Highlighted
            text={tileText(memory.body).slice(0, 800)}
            query={query}
          />
        </p>
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
