import { z } from "zod";

/**
 * Indexing (GLOSSARY.md): what one structured-output call returns, the model
 * chain, prices and the daily budget. Model ids and prices live here because
 * Gemini models are retired and repriced quickly (ADR-0005); see
 * docs/research/indexing-providers.md for where each number comes from.
 */
export const INDEXING = {
  /** Tried in order; a provider whose secret is missing is left out. */
  chain: ["workers-ai", "gemini"] as const,
  models: {
    "workers-ai": "@cf/google/gemma-4-26b-a4b-it",
    // Standard (synchronous) paid tier; never the free tier (ADR-0005).
    gemini: "gemini-3.5-flash-lite",
    fake: "fake",
  },
  /** List prices in micro-dollars per million tokens: [input, output]. */
  pricesMicrosPerMTokens: {
    "@cf/google/gemma-4-26b-a4b-it": [100_000, 300_000],
    "gemini-3.5-flash-lite": [300_000, 2_500_000],
    "gemini-3.1-flash-lite": [250_000, 1_500_000],
    fake: [0, 0],
  } as Record<string, readonly [number, number]>,
  /** Global AI spend per UTC day. Past it, background re-indexing waits for the next day. */
  dailyBudgetMicros: 2_000_000,
  /** Attempts per queue message before the Memory is Failed. */
  maxAttempts: 3,
  /** Text sent to a model is cut to this many characters. */
  maxInputChars: 24_000,
  /** Originals up to this size (and of a type every provider reads) go as they are; else the thumbnail. */
  maxImageBytes: 4 * 1024 * 1024,
  modelImageTypes: ["image/png", "image/jpeg", "image/webp"] as const,
} as const;

export type ProviderName = keyof typeof INDEXING.models;

/** Why Indexing failed, as stored in `memory.index_error` and shown with Retry. */
export const INDEX_FAILURES = [
  "unavailable",
  "invalid_output",
  "unreadable",
] as const;
export type IndexFailure = (typeof INDEX_FAILURES)[number];

/** Long fields are cut, not refused: a long OCR is still worth keeping. */
const text = (max: number) =>
  z.string().transform((s) => s.trim().slice(0, max));
const words = (count: number, max: number) =>
  z
    .array(z.string())
    .transform((all) =>
      [
        ...new Set(all.map((w) => w.trim().slice(0, max)).filter(Boolean)),
      ].slice(0, count)
    );

/** A primary language subtag of 2-3 letters, then any subtags Intl accepts. */
const isLanguageTag = (tag: string) => {
  if (!/^[a-z]{2,3}(-[a-z\d]{1,8})*$/i.test(tag)) return false;
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
};

/** What Extraction returns for one Memory (PLAN.md §5.3). */
export const IndexingOutput = z.object({
  title: text(300),
  description: text(2_000),
  ocrText: text(20_000),
  entities: words(20, 80),
  tags: words(12, 40),
  /** BCP-47, e.g. "en", "pt-BR"; "und" when there is no language. */
  language: z
    .string()
    .refine(isLanguageTag, "must be a BCP-47 language tag")
    .transform((tag) => Intl.getCanonicalLocales(tag)[0]!),
});
export type IndexingOutput = z.output<typeof IndexingOutput>;

/** The JSON Schema given to providers that constrain output to one. */
export const INDEXING_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, specific title" },
    description: {
      type: "string",
      description: "What the Memory shows or says, plainly, in 1-3 sentences",
    },
    ocrText: {
      type: "string",
      description: "All text visible in the image, verbatim; empty for text",
    },
    entities: {
      type: "array",
      items: { type: "string" },
      description: "People, places, brands, products and works named",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Up to 12 short descriptive labels",
    },
    language: {
      type: "string",
      description: "BCP-47 tag of the main language, or und",
    },
  },
  required: ["title", "description", "ocrText", "entities", "tags", "language"],
  additionalProperties: false,
} as const;

const HEX = /^#[\da-f]{6}$/;
/** An image's dominant colours, most of the image first, worked out at Capture. */
export const Palette = z.array(z.string().regex(HEX)).max(6);
export type Palette = z.infer<typeof Palette>;
