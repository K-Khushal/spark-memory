import { SparklesIcon } from "lucide-react";
import { Button, Chip } from "@spark/ui";
import type { Memory } from "./use-library";
import type { Found } from "./use-search";

const FIELD: Record<string, string> = {
  title: "Title",
  note: "Capture Note",
  tags: "Tag",
  text: "Text",
  ocr: "Text in Image",
  description: "Description",
};

/**
 * What matched, in a few words (DESIGN.md → why-chips): the field a word
 * was found in, the words of the passage that matched, or the image.
 * Undefined when nothing can be said.
 */
export function whyLabel({ part, body }: Pick<Found, "part" | "body">) {
  if (!part) return undefined;
  switch (part.kind) {
    case "field":
      return part.field && FIELD[part.field];
    case "passage": {
      if (part.field === "ocr") return FIELD.ocr;
      const words = (body ?? "").slice(part.start, part.end).trim();
      return words
        ? `“${words.replace(/\s+/g, " ").slice(0, 120)}”`
        : undefined;
    }
    case "visual":
      return "Image";
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
  return (
    <Chip
      tone={direct ? "spark" : "why"}
      className="mt-1.5"
      dir="auto"
      title={label}
    >
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
