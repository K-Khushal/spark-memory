import { describe, expect, it } from "vitest";
import {
  FREE_ALLOWANCE,
  INDEXING,
  indexedPages,
  PAGE_IMAGE,
  isPartlyIndexed,
  PdfCapture,
  PdfScanOutput,
} from "../index";

const page = { bytes: 1000, width: 1024, height: 1325 };
const pdf = (pages: number, images = indexedPages(pages)) => ({
  id: "8d6c2f55-4b6e-4f58-9b0a-2f7f0d1c9e01",
  bytes: 50_000,
  contentHash: "ab".repeat(32),
  title: "  Lease agreement  ",
  pages,
  width: 612,
  height: 792,
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp" as const, bytes: 300 },
  pageImages: Array.from({ length: images }, () => page),
});

describe("PDF Capture", () => {
  it("takes one page image per Indexed page", () => {
    expect(PdfCapture.safeParse(pdf(3)).success).toBe(true);
    const long = PdfCapture.parse(pdf(200));
    expect(long.pageImages).toHaveLength(FREE_ALLOWANCE.pdfPagesIndexed);
    expect(long.title).toBe("Lease agreement");
  });

  it("refuses page images that do not match the pages Indexed", () => {
    expect(PdfCapture.safeParse(pdf(3, 2)).success).toBe(false);
    expect(PdfCapture.safeParse(pdf(200, 31)).success).toBe(false);
    expect(PdfCapture.safeParse(pdf(200, 29)).success).toBe(false);
  });

  it("is Partly Indexed only past the Free allowance", () => {
    expect(isPartlyIndexed(FREE_ALLOWANCE.pdfPagesIndexed)).toBe(false);
    expect(isPartlyIndexed(FREE_ALLOWANCE.pdfPagesIndexed + 1)).toBe(true);
    expect(isPartlyIndexed(null)).toBe(false);
  });

  it("reads a scan's text page by page", () => {
    const out = PdfScanOutput.parse({
      title: "Receipt",
      description: "A scanned receipt",
      ocrText: "",
      entities: [],
      tags: [],
      language: "en",
      pages: [" Total 12.00 ", "Thank you"],
    });
    expect(out.pages).toEqual(["Total 12.00", "Thank you"]);
  });
});

describe("page images and Gemini's inline limit", () => {
  it("lets every Indexed page go in one request, base64 and all, with room for the text", () => {
    const base64 = (bytes: number) => Math.ceil(bytes / 3) * 4;
    const pages = FREE_ALLOWANCE.pdfPagesIndexed * base64(PAGE_IMAGE.maxBytes);
    // The prompt, the Memory's text (cut to maxInputChars) and the JSON around it.
    const text = 4 * INDEXING.maxInputChars + 64 * 1024;
    expect(pages + text).toBeLessThanOrEqual(INDEXING.inlineRequestBytes * 0.9);
  });
});
