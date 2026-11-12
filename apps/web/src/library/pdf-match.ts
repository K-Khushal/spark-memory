import type { MatchedPart } from "./search-session";

/** Where a PDF opens: the page that matched, and the passage on it to mark. */
export type PdfMatch = { page?: number; passage?: string };

/** The first page (1, 2…) of a PDF's text (pages apart by form feeds) holding a word of `query`. */
export function pageWithWords(body: string, query: string) {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  if (!words.length || !body.includes("\f")) return undefined;
  const index = body
    .toLowerCase()
    .split("\f")
    .findIndex((page) => words.some((w) => page.includes(w)));
  return index < 0 ? undefined : index + 1;
}

/**
 * Where a search result's PDF opens: a Passage's page with its words
 * marked, a page image's page, or the page of the word that matched. When
 * what matched names no page (the Overview), the first page holding a word
 * of `query`, as far as the wall knows the text; else the top.
 */
export function pdfMatch(
  memory: { body: string | null; part?: MatchedPart | null },
  query: string
): PdfMatch {
  const { part, body } = memory;
  if (part?.kind === "passage") {
    const words =
      part.field === "body" ? body?.slice(part.start, part.end).trim() : "";
    const page = part.page ?? (body ? pageWithWords(body, query) : undefined);
    return { ...(page && { page }), ...(words && { passage: words }) };
  }
  if ((part?.kind === "visual" || part?.kind === "field") && part.page) {
    return { page: part.page };
  }
  const page = body ? pageWithWords(body, query) : undefined;
  return page ? { page } : {};
}
