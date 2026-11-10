import { Fragment } from "react";
import { motion } from "motion/react";
import { cn } from "@spark/ui";
import { EASING } from "@spark/ui/tokens";
import type { WallMemory } from "./use-library";

// Masonry places tiles before they render, so a tile's height is worked out
// from its text at the column's width: padding, up to 3 title lines, then
// whole lines of text up to MAX_LINES. Character widths lean wide (wide
// scripts count double), so text gets a line too many rather than one cut.
const PADDING = 32;
const GAP = 8;
const TITLE = { charWidth: 9.6, lineHeight: 26, maxLines: 3 };
const BODY = { charWidth: 7, lineHeight: 20 };
const MAX_LINES = 12;
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/gu;

function lineCount(text: string, charsPerLine: number) {
  return text.split("\n").reduce((n, line) => {
    const chars = line.length + (line.match(WIDE)?.length ?? 0);
    return n + Math.max(1, Math.ceil(chars / charsPerLine));
  }, 0);
}

/** How a text tile lays out at `width`: its title and text lines, and its height. */
export function tileLayout(memory: WallMemory, width: number) {
  const inner = Math.max(1, width - PADDING);
  const title = memory.title
    ? Math.min(
        TITLE.maxLines,
        lineCount(memory.title, Math.floor(inner / TITLE.charWidth))
      )
    : 0;
  const body = Math.min(
    MAX_LINES - title,
    lineCount(memory.body ?? "", Math.floor(inner / BODY.charWidth))
  );
  const height =
    PADDING +
    title * TITLE.lineHeight +
    (title ? GAP : 0) +
    body * BODY.lineHeight;
  return { title, body, height };
}

/** The name a Memory goes by: its title, else the start of its text. */
export function memoryName(memory: WallMemory) {
  return memory.title || memory.body?.split("\n")[0]?.slice(0, 120) || "";
}

/** One text Memory on the wall: its title over its text, search words marked. */
export function MemoryTile({
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
    <motion.div
      className="h-full w-full"
      // DESIGN.md → Motion: a new Capture fades and grows into place.
      initial={memory.fresh ? { opacity: 0, scale: 0.96 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.26, ease: EASING.out }}
    >
      <figure className="group h-full cursor-pointer">
        <div className="relative flex h-full flex-col gap-2 overflow-hidden rounded-tile bg-sunken p-4 transition-transform duration-[120ms] ease-out group-active:scale-[0.98] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--edge)]">
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
              text={memory.body?.slice(0, 800) ?? ""}
              query={query}
            />
          </p>
        </div>
      </figure>
    </motion.div>
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
