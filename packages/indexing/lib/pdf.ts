import { FREE_ALLOWANCE, INDEXING } from "@spark/core";
import { withTimeout } from "./workers-ai";

/**
 * Reads a PDF's text, page by page (index 0 is page 1). One entry with no
 * page known when the reader could not tell the pages apart. Rejects when
 * the PDF could not be read at all.
 */
export type PdfReader = (bytes: Uint8Array) => Promise<string[]>;

/** The part of the Workers AI binding `toMarkdown` needs. */
export type MarkdownBinding = {
  toMarkdown(
    files: { name: string; blob: Blob },
    options?: { conversionOptions?: Record<string, unknown> }
  ): Promise<unknown>;
};

type Converted = { format?: string; data?: unknown };

// A page heading toMarkdown writes before each page's text ("## Page 3").
const PAGE = /^#{1,6}[ \t]*Page[ \t]+(\d+)[ \t]*$/gim;

/**
 * Pages of toMarkdown's Markdown. Text before the first page heading (the
 * file's name, metadata) is dropped; without any heading, the whole text is
 * one entry and no page is known.
 */
export function markdownPages(markdown: string): string[] {
  const marks = [...markdown.matchAll(PAGE)];
  if (!marks.length) return [markdown.trim()];
  const pages: string[] = [];
  marks.forEach((mark, i) => {
    const page = Number(mark[1]);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) return;
    const start = mark.index + mark[0].length;
    const end = marks[i + 1]?.index ?? markdown.length;
    pages[page - 1] = markdown.slice(start, end).trim();
  });
  return Array.from(pages, (p) => p ?? "");
}

/**
 * Workers AI `toMarkdown`: PDFs are parsed page by page with no model
 * (developers.cloudflare.com/workers-ai/features/markdown-conversion), and
 * for free. It still sends the file to the Workers AI service, so it is
 * never used for AI opt-out (ADR-0011). The binding takes no signal: a call
 * that outlives `timeoutMs` is given up on.
 */
export function workersAiPdf(
  ai: MarkdownBinding,
  timeoutMs: number = INDEXING.pdfTextTimeoutMs
): PdfReader {
  return async (bytes) => {
    const reply = await withTimeout(
      timeoutMs,
      ai.toMarkdown(
        {
          name: "memory.pdf",
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], {
            type: "application/pdf",
          }),
        },
        { conversionOptions: { pdf: { metadata: false } } }
      )
    );
    const result = (Array.isArray(reply) ? reply[0] : reply) as
      Converted | undefined;
    if (result?.format === "error" || typeof result?.data !== "string") {
      throw new Error("pdf: not converted");
    }
    return markdownPages(result.data);
  };
}

/**
 * The text a PDF Memory keeps as its own: the Indexed pages' text, pages
 * apart by a form feed (the page break of extracted text), cut to the
 * longest text a Memory holds. Empty when there is none.
 */
export function pdfBody(pages: string[], indexed: number): string {
  const kept = pages.length > 1 ? pages.slice(0, indexed) : pages;
  const text = kept.map((p) => p.replace(/\f/g, " ").trim()).join("\f");
  return text.replace(/\s/g, "")
    ? text.slice(0, FREE_ALLOWANCE.textMaxChars)
    : "";
}

/** A scan: fewer readable characters (spaces aside) than INDEXING.scanCharsPerPage a page. */
export const isScan = (text: string, indexed: number) =>
  text.replace(/\s/g, "").length <
  INDEXING.scanCharsPerPage * Math.max(1, indexed);

/**
 * A stand-in reader (INDEXING_PROVIDER=fake) for local development and the
 * smoke test: the literal strings drawn by each content stream that draws
 * text, one stream a page. Enough for a simple uncompressed PDF; anything
 * else reads as a scan. No network.
 */
export function fakePdfReader(): PdfReader {
  return async (bytes) => {
    const raw = new TextDecoder("latin1").decode(bytes);
    const pages: string[] = [];
    for (const [, stream] of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      const words = [...stream!.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(
        ([, s]) => s!.replace(/\\(.)/g, "$1")
      );
      if (words.length) pages.push(words.join(" "));
    }
    return pages.length ? pages : [""];
  };
}
