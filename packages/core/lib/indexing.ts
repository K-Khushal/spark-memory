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
    jev: "jev-1.14.0",
  },
  /**
   * List prices in micro-dollars per million tokens: [input, output] and,
   * where audio costs something else, a third: its input price
   * (`modelCostMicros`). Flash-Lite lists audio at the same $0.30 as text;
   * it is said outright so a change is one number
   * (docs/research/deep-fetch.md).
   */
  pricesMicrosPerMTokens: {
    "@cf/google/gemma-4-26b-a4b-it": [100_000, 300_000],
    "gemini-3.5-flash-lite": [300_000, 2_500_000, 300_000],
    // Priced too, so switching `models.gemini` to it is a one-line change.
    "gemini-3.1-flash-lite": [250_000, 1_500_000],
    // Input only; output is free (docs/research/jev.md).
    "jev-1.14.0": [42_000, 0],
    fake: [0, 0],
  } as Record<string, readonly [number, number, number?]>,
  /** Global AI spend per UTC day ($1). Past it, background re-indexing waits for the next day. */
  dailyBudgetMicros: 1_000_000,
  /**
   * Longest wait for one provider call. A run makes at most four (two
   * providers, each with one corrective retry), 4 minutes in all, inside
   * its 5-minute lease, which each call also renews.
   */
  providerTimeoutMs: 60_000,
  /** Attempts per queue message before the Memory is Failed. */
  maxAttempts: 3,
  /** Text sent to a model is cut to this many characters. */
  maxInputChars: 24_000,
  /** Originals up to this size (and of a type every provider reads) go as they are; else the thumbnail. */
  maxImageBytes: 4 * 1024 * 1024,
  modelImageTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  /**
   * A PDF with fewer readable characters than this per Indexed page
   * (spaces aside) is a scan: its page images go to Gemini, which reads
   * them (ADR-0005, PLAN.md §5.3).
   */
  scanCharsPerPage: 100,
  /** Longest wait for a PDF's text (Workers AI `toMarkdown`). */
  pdfTextTimeoutMs: 30_000,
  /**
   * The most one Gemini request may carry inline (20 MB, images base64).
   * A bigger one is refused before it is sent, as unsupported.
   */
  inlineRequestBytes: 20_000_000,
  /** Output room for a scan's text, page by page: about 2,000 characters a page. */
  scanMaxOutputTokens: 16_384,
  /** The most output an Extraction asks a provider for (a scan has `scanMaxOutputTokens`). */
  maxOutputTokens: 4_096,
  /** The most output a reel transcription asks for. */
  transcribeMaxOutputTokens: 8_192,
  /** What a second of video with its audio is counted as. */
  transcribeTokensPerSecond: 300,
  /** What one image or page image is held at before a call: above any provider's high-resolution count. */
  heldImageTokens: 1_600,
} as const;

/**
 * An upper bound on the tokens in `text`: its UTF-8 bytes. No tokenizer
 * makes more tokens than bytes, so multilingual text (Hindi, Japanese,
 * emoji: three or four bytes a character) cannot exceed what a hold counted.
 */
export function maxTokens(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < text.length) {
      // A surrogate pair is one code point of four bytes.
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export type ProviderName = keyof typeof INDEXING.models;

/**
 * What one model call cost, in micro-dollars, rounded up. `audio` says the
 * input was mostly audio, which a model may price apart from text; a model
 * with no audio price charges it as text.
 */
export function modelCostMicros(
  model: string,
  usage: { inputTokens: number; outputTokens: number; audio?: boolean }
): number {
  const [input, output, audio] = INDEXING.pricesMicrosPerMTokens[model] ?? [
    0, 0,
  ];
  const rate = usage.audio ? (audio ?? input) : input;
  return Math.ceil(
    (usage.inputTokens * rate + usage.outputTokens * output) / 1_000_000
  );
}

/**
 * Embedding (ADR-0004): Overview, Visual and Passage vectors in one
 * text-and-image space. Gemini Embedding 2 runs on the paid tier only
 * (ADR-0005); its 768-dimension output comes back normalised. Sources in
 * docs/research/embeddings.md. Changing `model` or `dimensions` makes every
 * stored vector stale: the hourly sweep re-embeds them in the background.
 */
export const EMBEDDING = {
  model: "gemini-embedding-2",
  dimensions: 768,
  /** Micro-dollars per million input tokens, standard (not Batch) tier. */
  pricesMicrosPerMTokens: {
    "gemini-embedding-2": { text: 200_000, image: 450_000 },
    "fake-embedding": { text: 0, image: 0 },
  } as Record<string, { text: number; image: number }>,
  /** Model input types for a Visual vector. */
  imageTypes: ["image/png", "image/jpeg"] as const,
  /**
   * About 500 tokens a Passage at ~4 characters a token: long enough to
   * hold one idea, short enough that one idea is not blurred into the rest
   * (ADR-0004's ~400 tokens, rounded to whole paragraphs), and far inside
   * the model's 8,192-token limit, past which it truncates silently.
   */
  passageChars: 2_000,
  /** Passages overlap so an idea cut at a boundary is whole in one of them. */
  passageOverlapChars: 200,
  /** Passages per Memory; the rest of a very long text is not embedded. */
  maxPassages: 30,
  /** A PDF's Indexed pages hold about two Passages each. */
  maxPdfPassages: 60,
  /** Covers the full 100,000-character transcript, including overlap. */
  maxVideoPassages: 60,
  /** The model cuts each input at this many tokens (8,192). */
  maxInputTokens: 8_192,
  /** One call for a Memory's vectors. */
  timeoutMs: 30_000,
  /** A query waits this long, then full search goes on without vectors. */
  queryTimeoutMs: 2_500,
  /**
   * Cosine distances, guesses until the search test set tunes them (evals/,
   * #11): a Memory joins the vector leg within `maxDistance` of the query.
   * What makes a Direct Match is in judging.ts.
   */
  maxDistance: 0.6,
  /** A person's repeated query reuses its vector this long (per Worker isolate). */
  queryCacheMs: 5 * 60_000,
  queryCacheSize: 500,
  /** An edited title waits this long, so a burst of autosaves embeds once. */
  editDelaySeconds: 60,
  /** Stale or missing vectors re-embedded per hourly sweep. */
  sweepBatch: 100,
} as const;

/** How stored vectors name what made them: model and dimensions. */
export const embeddingSpace = (
  model: string = EMBEDDING.model,
  dimensions: number = EMBEDDING.dimensions
) => `${model}@${dimensions}`;

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

/**
 * A scanned page's text is kept to about this many characters (a Passage),
 * so 30 pages fit INDEXING.scanMaxOutputTokens.
 */
export const SCAN_PAGE_CHARS = 1_500;

/**
 * What Extraction returns for a scanned PDF: the usual fields, and the
 * text of each page image, in order, so a Passage knows its page.
 */
export const PdfScanOutput = IndexingOutput.extend({
  pages: z.array(text(SCAN_PAGE_CHARS)).max(60),
});
export type PdfScanOutput = z.output<typeof PdfScanOutput>;

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

/** The scan's schema: the usual one, plus each page's text. */
export const PDF_SCAN_OUTPUT_JSON_SCHEMA = {
  ...INDEXING_OUTPUT_JSON_SCHEMA,
  properties: {
    ...INDEXING_OUTPUT_JSON_SCHEMA.properties,
    ocrText: {
      type: "string",
      description: "Empty: the text goes in pages",
    },
    pages: {
      type: "array",
      items: { type: "string" },
      description:
        "The text of each page image, verbatim, at most 1,500 characters a page, one entry per image, in order",
    },
  },
  required: [...INDEXING_OUTPUT_JSON_SCHEMA.required, "pages"],
} as const;

const HEX = /^#[\da-f]{6}$/;
/** An image's dominant colours, most of the image first, worked out at Capture. */
export const Palette = z.array(z.string().regex(HEX)).max(6);
export type Palette = z.infer<typeof Palette>;
