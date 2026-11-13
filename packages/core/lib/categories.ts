import { z } from "zod";

/**
 * The built-in Categories (ADR-0008); the names are also the API values.
 * A person's own Categories sit beside them (`checkCategoryName`).
 */
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
export const CATEGORY_NAME_MAX_CHARS = 40;
/** Jev takes up to 255 options; 50 of a person's own is plenty for a Library. */
export const MAX_CUSTOM_CATEGORIES = 50;

/**
 * A Memory's Categories by name. Only the shape is checked here: whether a
 * name is a built-in or the owner's own is the database's to say.
 */
export const Categories = z
  .array(z.string().min(1).max(CATEGORY_NAME_MAX_CHARS))
  .min(1)
  .max(MAX_CATEGORIES)
  .refine(
    (names) => new Set(names).size === names.length,
    "Categories must be distinct"
  );

/** Creating or renaming a Category: the name as typed; `checkCategoryName` judges it. */
export const CategoryRequest = z.object({ name: z.string().max(200) }).strict();

/** Words that stay lower case inside a Title Case name, as in "Receipt or Document". */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

/** Why a new Category name was refused. */
export type CategoryNameProblem =
  "empty" | "long" | "characters" | "case" | "duplicate";

const key = (name: string) => name.toLowerCase();

/** Every word starts with a capital where its script has one; minor words after the first may not. */
function isTitleCase(name: string): boolean {
  return name.split(" ").every((word, i) => {
    if (i > 0 && MINOR_WORDS.has(word)) return true;
    const first = /\p{L}/u.exec(word)?.[0];
    return !first || first === first.toUpperCase();
  });
}

/**
 * A person's name for a Category, as they typed it: trimmed, spaces inside
 * kept as one, never re-cased (it must already be Title Case). `taken` is
 * every other name in play, the built-ins and the person's own; a duplicate
 * is judged without regard to case.
 */
export function checkCategoryName(
  raw: string,
  taken: readonly string[]
): { name: string } | { problem: CategoryNameProblem } {
  if (/\p{Cc}/u.test(raw.trim())) return { problem: "characters" };
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { problem: "empty" };
  if ([...name].length > CATEGORY_NAME_MAX_CHARS) return { problem: "long" };
  const same = key(name);
  const builtIn = CATEGORY_NAMES.some((b) => key(b) === same);
  if (builtIn || taken.some((other) => key(other) === same)) {
    return { problem: "duplicate" };
  }
  return isTitleCase(name) ? { name } : { problem: "case" };
}

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

/** What the fallback compares a Memory with for `name`: a built-in's sentence, else one made of the name. */
export function prototypeOf(name: string): string {
  return Object.hasOwn(CATEGORISING.prototypes, name)
    ? CATEGORISING.prototypes[name as Category]
    : `Memories about ${name}`;
}

/** The strongest Categories at or above `threshold`, at most 3; Other when none. */
export function chooseCategories(
  scores: Readonly<Record<string, number | undefined>>,
  threshold: number
): string[] {
  const chosen = Object.keys(scores)
    .filter((name) => name !== "Other" && (scores[name] ?? -1) >= threshold)
    // Equal scores keep the order they were given in, built-ins first.
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
