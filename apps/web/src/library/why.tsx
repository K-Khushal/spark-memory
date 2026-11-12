import { formatTimestamp, sourceOf } from "@spark/core";
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

/**
 * What matched, in a few words (DESIGN.md → why-chips): the field a word
 * was found in, the words of the passage that matched, or the image.
 * Undefined when nothing can be said.
 */
export function whyLabel({
  part,
  body,
  kind,
}: Pick<Found, "part" | "body" | "kind">) {
  if (!part) return undefined;
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
      return words
        ? `“${words.replace(/\s+/g, " ").slice(0, 120)}”`
        : undefined;
    }
    case "visual":
      return part.page ? `Page ${part.page}` : "Image";
    case "overview":
      return "Overview";
  }
}

/** Height a why-chip takes under a result tile (h-6 plus its margin). */
export const WHY_HEIGHT = 30;

/** What matched most strongly in a result, under its tile: the highlighter for a Direct Match. */
export function WhyChip({ found, direct }: { found: Found; direct: boolean }) {
  const label = whyLabel(found);
  if (!label) return null;
  const { part } = found;
  return (
    <Chip
      tone={direct ? "spark" : "why"}
      className="mt-1.5"
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
