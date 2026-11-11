import { EMBEDDING, type IndexingOutput, type ProviderName } from "@spark/core";

/** One thing to embed: a piece of text, or an image's bytes. */
export type EmbedInput =
  { text: string } | { image: { bytes: Uint8Array; mime: string } };

export type EmbedUsage = { textTokens: number; imageTokens: number };

/** An embedding model behind the same seam as Extraction's providers. */
export type Embedder = {
  name: ProviderName;
  model: string;
  dimensions: number;
  /** One vector per input, in order. Throws ProviderError. */
  embed(
    inputs: EmbedInput[],
    options?: { timeoutMs?: number }
  ): Promise<{ vectors: number[][]; usage: EmbedUsage }>;
};

/** Which part of a Memory a vector stands for (ADR-0004). */
export type VectorPart =
  | { kind: "overview" }
  | { kind: "visual" }
  | {
      kind: "passage";
      /** Character offsets into the Memory's text or the text in its image. */
      anchor: { field: "body" | "ocr"; start: number; end: number };
    };

/** A Memory's vectors, as one model made them from one revision of its text. */
export type Embedding = {
  model: string;
  dimensions: number;
  revision: number;
  vectors: (VectorPart & { embedding: number[] })[];
};

export const embedCostMicros = (model: string, usage: EmbedUsage) => {
  const price = EMBEDDING.pricesMicrosPerMTokens[model] ?? {
    text: 0,
    image: 0,
  };
  return Math.ceil(
    (usage.textTokens * price.text + usage.imageTokens * price.image) /
      1_000_000
  );
};

/** What the vectors are made from: the Memory's own text and what Extraction found. */
export type EmbedSource = {
  title: string | null;
  captureNote: string | null;
  body: string | null;
  found: Pick<
    IndexingOutput,
    "title" | "description" | "ocrText" | "tags" | "entities"
  >;
};

/** The document side of Gemini Embedding 2's retrieval prompt (no task_type field). */
const document = (title: string, text: string) =>
  `title: ${title || "none"} | text: ${text}`;

/** The query side. */
export const queryText = (query: string) =>
  `task: search result | query: ${query}`;

/**
 * Passages of about EMBEDDING.passageChars, overlapping, cut at a paragraph,
 * sentence or word where one is near the end. Offsets into `text`.
 */
export function passages(text: string, max = EMBEDDING.maxPassages) {
  const size = EMBEDDING.passageChars;
  const out: { start: number; end: number }[] = [];
  let start = text.search(/\S/);
  while (start >= 0 && start < text.length && out.length < max) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const from = start + size / 2;
      const window = text.slice(from, end);
      for (const sep of ["\n\n", ". ", "\n", " "]) {
        const i = window.lastIndexOf(sep);
        if (i >= 0) {
          end = from + i + sep.length;
          break;
        }
      }
    }
    if (text.slice(start, end).trim()) out.push({ start, end });
    if (end >= text.length) break;
    // Back by the overlap, then forward to the start of a word inside it
    // (text without spaces is cut where it falls).
    const back = Math.max(start + 1, end - EMBEDDING.passageOverlapChars);
    const word = text.slice(back, end).search(/(?<=\s)\S/);
    start = word < 0 ? back : back + word;
  }
  return out;
}

/**
 * The inputs for a Memory's vectors, and the part each one stands for:
 * one Overview (title, description, Tags, entities, Capture note), one
 * Visual when there is an image the model reads, and Passages of its text
 * and of the text in its image.
 */
export function embeddingInputs(
  source: EmbedSource,
  image?: { bytes: Uint8Array; mime: string }
): { inputs: EmbedInput[]; parts: VectorPart[] } {
  const { found } = source;
  const title = source.title || found.title;
  const inputs: EmbedInput[] = [];
  const parts: VectorPart[] = [];
  const overview = [
    found.description,
    source.captureNote,
    found.tags.join(", "),
    found.entities.join(", "),
  ]
    .filter(Boolean)
    .join("\n");
  inputs.push({ text: document(title, overview) });
  parts.push({ kind: "overview" });
  if (image) {
    inputs.push({ image });
    parts.push({ kind: "visual" });
  }
  let room = EMBEDDING.maxPassages;
  for (const [field, text] of [
    ["body", source.body ?? ""],
    ["ocr", found.ocrText],
  ] as const) {
    for (const p of passages(text, room)) {
      inputs.push({ text: document(title, text.slice(p.start, p.end)) });
      parts.push({ kind: "passage", anchor: { field, ...p } });
      room--;
    }
  }
  return { inputs, parts };
}
