import { useSyncExternalStore } from "react";
import { rootFontScale } from "./root-font-scale";

// A tile's title wraps to at most two lines (DESIGN.md → Type), and the wall
// places tiles before they render, so the line count is worked out here:
// a greedy wrap, as the browser does it, measured with a canvas at the
// display font. Before the font has landed (and where there is no canvas) a
// character estimate stands in, and the wall measures again once fonts load.

export const TITLE_MAX_LINES = 2;

/** Width of `text` in px at the title's own size. */
export type Measure = (text: string) => number;

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-￯]/gu;
/** Roughly what a character of Latin text is, in em; wide scripts are 1em. */
const AVERAGE_EM = 0.55;

/** Character-count stand-in for a measured width, in px at `size`. */
export const estimate =
  (size: number): Measure =>
  (text) => {
    const wide = text.match(WIDE)?.length ?? 0;
    return (text.length - wide) * AVERAGE_EM * size + wide * size;
  };

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;
const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

const pieces = (text: string, by: Intl.Segmenter | undefined) =>
  by
    ? Array.from(by.segment(text), (part) => part.segment)
    : text.split(/(\s+)/).filter(Boolean);

/**
 * Lines `title` takes in `width`, at most `max`: words stay whole and a word
 * wider than the line breaks where it must, as `overflow-wrap: anywhere` does.
 */
export function wrapLines(
  title: string,
  width: number,
  measure: Measure,
  max = TITLE_MAX_LINES
): number {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return 1;
  let lines = 1;
  let used = 0;
  const place = (piece: string): void => {
    const w = measure(piece);
    if (used + w <= width) {
      used += w;
      return;
    }
    if (/^\s+$/.test(piece)) return; // trailing space hangs, it never wraps
    if (used > 0) {
      lines++;
      used = 0;
      if (lines > max) return;
    }
    if (w <= width) {
      used = w;
      return;
    }
    // Wider than a line by itself: break by character.
    for (const character of pieces(piece, graphemes)) {
      const cw = measure(character);
      if (used + cw > width && used > 0) {
        lines++;
        used = 0;
        if (lines > max) return;
      }
      used += cw;
    }
  };
  for (const piece of pieces(text, segmenter)) {
    place(piece);
    if (lines > max) break;
  }
  return Math.min(max, lines);
}

let context: CanvasRenderingContext2D | null | undefined;
let fontStack: string | undefined;
let fontsLoaded = false;
let fontRevision = 0;
const listeners = new Set<() => void>();

/** The canvas the whole wall measures with (none in a test DOM). */
function canvas() {
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  return context;
}

const spec = () => {
  fontStack ??=
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-display")
      .trim() || "sans-serif";
  return fontStack;
};

/** Whether the display font itself is ready: "loaded" alone can be true before it was ever asked for. */
const displayFontReady = () =>
  typeof document !== "undefined" &&
  !!document.fonts &&
  document.fonts.status === "loaded" &&
  document.fonts.check(`500 16px ${spec()}`);

if (typeof document !== "undefined" && document.fonts) {
  const update = () => {
    if (!displayFontReady()) return;
    fontsLoaded = true;
    fontRevision++;
    cache.clear();
    bodyCache.clear();
    for (const notify of listeners) notify();
  };
  fontsLoaded = displayFontReady();
  void document.fonts.ready.then(update, () => {});
  document.fonts.addEventListener?.("loadingdone", update);
}

/**
 * Whether the display font has loaded; the wall subscribes, and measures its
 * titles again once it has.
 */
export const titleFonts = {
  /** For tests: the display font is in. */
  markLoaded() {
    fontsLoaded = true;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  loaded: () => fontsLoaded,
};

const cache = new Map<string, number>();

/**
 * How many lines (1 or 2) a title takes in `innerWidth` px, at `size` px
 * (before the root font scale) in the display font at weight 500.
 */
export function titleLines(title: string, innerWidth: number, size: number) {
  const k = rootFontScale();
  const width = innerWidth / k - 1; // a pixel of slack: wrap late, never early
  // Once the font is in, a title is always measured: no shortcut from an
  // average character width, which "WWWW" and "iiii" both defeat.
  const ctx = fontsLoaded ? canvas() : null;
  const key = `${ctx ? 1 : 0}|${size}|${Math.round(width)}|${title}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let measure = estimate(size);
  if (ctx) {
    ctx.font = `500 ${size}px ${spec()}`;
    measure = (text) => ctx.measureText(text).width;
  }
  const lines = wrapLines(title, width, measure);
  if (cache.size > 20_000) cache.clear();
  cache.set(key, lines);
  return lines;
}

/** True once the display font has loaded: re-render the wall then, so its titles are measured again. */
export const useTitleFonts = () =>
  useSyncExternalStore(
    titleFonts.subscribe,
    () => fontRevision,
    () => 0
  );

const bodyCache = new Map<string, number>();
/** Cached font-aware wrapping, including fallback shaping and paragraph breaks. */
export function bodyLines(
  text: string,
  innerWidth: number,
  max: number,
  paragraphs = true
) {
  const k = rootFontScale();
  const width = Math.max(1, innerWidth);
  const key = `${fontRevision}|${fontsLoaded}|${width}|${k}|${max}|${paragraphs}|${text}`;
  const known = bodyCache.get(key);
  if (known !== undefined) return known;
  const ctx = canvas();
  let measure = estimate(13 * k);
  if (ctx) {
    const family =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-sans")
        .trim() || "sans-serif";
    ctx.font = `400 ${13 * k}px ${family}`;
    measure = (piece) => ctx.measureText(piece).width;
  }
  // pre-line preserves paragraph breaks, collapses spaces and ignores the
  // final newline. Normal link descriptions collapse all whitespace.
  const paragraphsToMeasure = paragraphs
    ? text.replace(/\n$/, "").split("\n")
    : [text];
  const lines = paragraphsToMeasure.reduce(
    (sum, line) => sum + wrapLines(line, width, measure, max),
    0
  );
  const result = Math.min(max, lines);
  if (bodyCache.size > 20_000) bodyCache.clear();
  bodyCache.set(key, result);
  return result;
}
