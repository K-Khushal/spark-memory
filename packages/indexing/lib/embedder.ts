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
  /** An image's, or a PDF page's (`anchor.page`). */
  | { kind: "visual"; anchor?: { page: number } }
  | {
      kind: "passage";
      /** Character offsets into the Memory's text or the text in its image, and a PDF's page. */
      anchor: {
        field: "body" | "ocr";
        start: number;
        end: number;
        page?: number;
      };
    };

/** An image the model reads for a Visual vector, and the PDF page it is of. */
export type Visual = {
  image: { bytes: Uint8Array; mime: string };
  page?: number;
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
  /** A PDF's page count: its text is pages apart by form feeds. */
  pages?: number | null;
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
export function passages(text: string, max: number = EMBEDDING.maxPassages) {
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
 * Passages of a PDF's text page by page, none across a page break (a form
 * feed), sharing `max` evenly so every page gets some. Its page is known
 * when there are breaks, or the PDF has one page; else none is said.
 */
export function pagePassages(text: string, max: number, pages: number) {
  const known = text.includes("\f") || pages === 1;
  const each = text.split("\f");
  const perPage = Math.max(1, Math.floor(max / each.length));
  const out: { start: number; end: number; page?: number }[] = [];
  let offset = 0;
  each.forEach((segment, i) => {
    for (const p of passages(segment, Math.min(perPage, max - out.length))) {
      out.push({
        start: offset + p.start,
        end: offset + p.end,
        ...(known && { page: i + 1 }),
      });
    }
    offset += segment.length + 1;
  });
  return out;
}

/**
 * The inputs for a Memory's vectors, and the part each one stands for:
 * one Overview (title, description, Tags, entities, Capture note), a
 * Visual for each image the model reads (an image, or a PDF's pages), and
 * Passages of its text and of the text in its image (a PDF's page by page).
 */
export function embeddingInputs(
  source: EmbedSource,
  visuals: Visual[] = []
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
  for (const { image, page } of visuals) {
    inputs.push({ image });
    parts.push(
      page ? { kind: "visual", anchor: { page } } : { kind: "visual" }
    );
  }
  const pdf = source.pages ?? 0;
  let room = pdf ? EMBEDDING.maxPdfPassages : EMBEDDING.maxPassages;
  for (const [field, text] of [
    ["body", source.body ?? ""],
    ["ocr", found.ocrText],
  ] as const) {
    const cut = pdf ? pagePassages(text, room, pdf) : passages(text, room);
    for (const p of cut) {
      inputs.push({ text: document(title, text.slice(p.start, p.end)) });
      parts.push({ kind: "passage", anchor: { field, ...p } });
      room--;
    }
  }
  return { inputs, parts };
}
