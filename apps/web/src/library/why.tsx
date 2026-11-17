import { rootFontScale } from "./root-font-scale";
import { formatTimestamp, sourceOf, type SearchChips } from "@spark/core";
import { SparklesIcon } from "lucide-react";
import { Button, Chip } from "@spark/ui";
import { FILTER_COLOURS } from "@spark/ui/tokens";
import { sourceLabel } from "./library-filters";
import type { Memory } from "./use-library";
import type { Found } from "./use-search";

const FIELD: Record<string, string> = {
  title: "Title",
  note: "Capture Note",
  tags: "Tag",
  text: "Text",
  ocr: "Text in Image",
  description: "Description",
  source: "Source",
};

const KIND_WHY: Record<string, string> = {
  image: "Image",
  pdf: "PDF",
  video: "Video",
  link: "Link",
  social_post: "Link",
  text: "Note",
};

/** The characters of `text` as people count them: whole graphemes, else whole code points where `Intl.Segmenter` is missing. */
function characters(text: string): Iterable<string> {
  if (typeof Intl.Segmenter !== "function") return text;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return (function* () {
    for (const { segment } of segments.segment(text)) yield segment;
  })();
}

/**
 * The first `max` characters of `text` as people count them: whole
 * graphemes, so text without spaces (Chinese, Japanese, emoji with
 * joiners) never ends mid-character, as a plain `slice` can. Without
 * `Intl.Segmenter` it counts code points, which never splits a surrogate pair.
 */
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  let end = 0;
  let count = 0;
  for (const character of characters(text)) {
    if (++count > max) break;
    end += character.length;
  }
  return text.slice(0, end);
}

/** The palette colour, as the nearest name people say it by. */
export function colourName(hex: string) {
  const channels = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = channels(hex);
  let best: (typeof FILTER_COLOURS)[number] = FILTER_COLOURS[0];
  let nearest = Infinity;
  for (const c of FILTER_COLOURS) {
    const [cr, cg, cb] = channels(c.hex);
    const d = (r! - cr!) ** 2 + (g! - cg!) ** 2 + (b! - cb!) ** 2;
    if (d < nearest) [best, nearest] = [c, d];
  }
  return best.name;
}

/** What a filter chip found a Memory by: its colour, Source, day, Category or kind. */
function filterWhy({
  field,
  value,
}: Extract<NonNullable<Found["part"]>, { kind: "filter" }>) {
  switch (field) {
    case "colour":
      return colourName(value);
    case "source":
      return sourceLabel(sourceOf(`https://${value}/`) ?? value);
    case "date":
      return `Saved ${new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    case "category":
      return value;
    case "kind":
      return KIND_WHY[value];
  }
}

/** The sidebar choice a filter part is the answer to. */
const CHOSEN_BY: Record<
  Extract<NonNullable<Found["part"]>, { kind: "filter" }>["field"],
  keyof SearchChips
> = {
  colour: "colour",
  source: "source",
  date: "when",
  category: "category",
  kind: "kind",
};

/**
 * What matched, in a few words (DESIGN.md → why-chips): the field a word
 * was found in, the words of the passage that matched, or the image.
 * Undefined when nothing can be said, or when the only reason is a filter
 * chosen in the sidebar (`chips`): that would say the same on every tile.
 */
export function whyLabel(
  { part, body, kind }: Pick<Found, "part" | "body" | "kind">,
  chips?: SearchChips
) {
  if (!part) return undefined;
  if (part.kind === "filter" && chips?.[CHOSEN_BY[part.field]] !== undefined)
    return undefined;
  // A scanned PDF's text is read from its pages, not an image.
  const ocr = kind === "pdf" ? FIELD.text : FIELD.ocr;
  switch (part.kind) {
    case "filter":
      return filterWhy(part);
    case "field":
      return part.field === "ocr" ? ocr : part.field && FIELD[part.field];
    case "passage": {
      if (part.seconds !== undefined)
        return `Said at ${formatTimestamp(part.seconds)}`;
      if (part.field === "ocr") return part.page ? `Page ${part.page}` : ocr;
      const words = (body ?? "").slice(part.start, part.end).trim();
      return words ? `“${clip(words.replace(/\s+/g, " "), 120)}”` : undefined;
    }
    case "visual":
      return part.page ? `Page ${part.page}` : "Image";
    case "overview":
      return "Overview";
  }
}

/** Height of the footer a why-chip sits in, inside its result tile (the h-6 chip centred). */
export const WHY_HEIGHT = 36;

/** Caption height follows the same root text scaling as the chip. */
export const whyHeight = () => WHY_HEIGHT * rootFontScale();

/** What matched most strongly in a result, in its tile's footer: the highlighter for a Direct Match. */
export function WhyChip({
  found,
  direct,
  chips,
  visiblePassage = false,
}: {
  found: Found;
  direct: boolean;
  chips?: SearchChips;
  visiblePassage?: boolean;
}) {
  const label = visiblePassage ? "Text" : whyLabel(found, chips);
  if (!label) return null;
  const { part } = found;
  return (
    <Chip
      tone={direct ? "spark" : "why"}
      className="max-w-full"
      dir="auto"
      title={label}
    >
      {part?.kind === "filter" && part.field === "colour" && (
        // The palette colour that matched, not the one asked for.
        <i
          aria-hidden
          className="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_22%,transparent)]"
          style={{ backgroundColor: part.value }}
        />
      )}
      <span>{label}</span>
    </Chip>
  );
}

/**
 * More Like This, for Memory detail and the image viewer, only for a
 * Memory with vectors this environment searches with (`hasVectors`: none
 * for AI opt-out, before embedding, or without the paid tier).
 */
export function MoreLikeThis({
  memory,
  onSelect,
  compact = false,
  className,
}: {
  memory: Memory;
  onSelect: (memory: Memory) => void;
  /** Icon only on a phone (the image viewer's crowded toolbar). */
  compact?: boolean;
  className?: string;
}) {
  if (!memory.hasVectors) return null;
  return (
    <Button
      variant="quiet"
      size="sm"
      className={className}
      onClick={() => onSelect(memory)}
    >
      <SparklesIcon aria-hidden />
      <span className={compact ? "max-sm:sr-only" : undefined}>
        More Like This
      </span>
    </Button>
  );
}
