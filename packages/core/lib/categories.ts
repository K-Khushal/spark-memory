import { z } from "zod";

/** Built-in Categories (ADR-0008); the names are also the API values. */
export const CATEGORY_NAMES = [
  "Article",
  "Video",
  "Social Post",
  "Design Reference",
  "Screenshot",
  "Product",
  "Recipe",
  "Place",
  "Receipt or Document",
  "Code",
  "Tutorial",
  "Quote",
  "Idea",
  "Other",
] as const;
export const Category = z.enum(CATEGORY_NAMES);
export type Category = z.infer<typeof Category>;

export const MAX_CATEGORIES = 3;
export const Categories = z
  .array(Category)
  .min(1)
  .max(MAX_CATEGORIES)
  .refine(
    (names) => new Set(names).size === names.length,
    "Categories must be distinct"
  );

/**
 * Jev answers a Choice with probabilities that sum to about 1; the
 * embedding fallback compares cosines. Both thresholds are starting points
 * (Jev is off until the owner enables it; see docs/research/jev.md).
 */
export const CATEGORISING = {
  /**
   * Bump it whenever the thresholds, the prototype sentences or the Jev
   * question change: every unlocked Memory is then categorised again, a few
   * at a time by the hourly sweep, inside the daily budget.
   */
  version: 1,
  jevThreshold: 0.2,
  embeddingThreshold: 0.45,
  /** A Category's name read as its prototype for the fallback. */
  prototypes: {
    Article: "An article, essay or blog post to read",
    Video: "A video to watch",
    "Social Post": "A post or thread from a social network",
    "Design Reference":
      "Design inspiration: a layout, interface, logo or visual style",
    Screenshot: "A screenshot of an app or a screen",
    Product: "A product to buy or a shop listing",
    Recipe: "A recipe with ingredients and cooking steps",
    Place: "A place to visit: a restaurant, hotel, city or landmark",
    "Receipt or Document": "A receipt, invoice, form or official document",
    Code: "Source code, a repository or a programming reference",
    Tutorial: "A tutorial or guide that teaches how to do something",
    Quote: "A quote or saying",
    Idea: "A personal idea or note to remember",
    Other: "Something else",
  } satisfies Record<Category, string>,
} as const;

/** The strongest Categories at or above `threshold`, at most 3; Other when none. */
export function chooseCategories(
  scores: Partial<Record<Category, number>>,
  threshold: number
): Category[] {
  const chosen = CATEGORY_NAMES.filter(
    (name) => name !== "Other" && (scores[name] ?? -1) >= threshold
  )
    .sort((a, b) => scores[b]! - scores[a]!)
    .slice(0, MAX_CATEGORIES);
  return chosen.length ? chosen : ["Other"];
}

/** Cosine similarity; vectors that cannot be compared score -1. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i]!, b[i]!];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const norm = Math.sqrt(na * nb);
  return Number.isFinite(norm) && norm > 0 && Number.isFinite(dot)
    ? dot / norm
    : -1;
}

/** Jev's answer to the one Choice question, checked before any score is trusted. */
export const JevChoiceReply = z.object({
  answers: z.object({
    category: z.object({
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  }),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }),
});
