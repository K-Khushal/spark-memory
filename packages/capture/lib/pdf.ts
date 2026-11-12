import type * as PdfjsModule from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  FREE_ALLOWANCE,
  indexedPages,
  isFileWithinAllowance,
  PAGE_IMAGE,
  PDF_TYPE,
} from "@spark/core";
import { encode, sha256, summaryOf, type ImageRefusal } from "./image";

/** One Indexed page, drawn as Spark keeps it. */
export type PageImage = { blob: Blob; width: number; height: number };

/**
 * A PDF ready to Capture: the file as it is (the Preserved copy), its
 * first page drawn for the wall, and its Indexed pages drawn on demand.
 */
export type PreparedPdf = {
  file: Blob;
  /** SHA-256 of `file`, hex. */
  contentHash: string;
  /** The file's name without `.pdf`. */
  title: string | null;
  pages: number;
  /** The first page's image size, for the wall. */
  width: number;
  height: number;
  thumbhash: string;
  palette: string[];
  thumbnail: Blob;
  thumbnailMime: "image/webp" | "image/jpeg";
  /**
   * Draws every Indexed page (once; later calls share the answer), then
   * lets the PDF go. Rejects with "unreadable".
   */
  pageImages: () => Promise<PageImage[]>;
  /** Lets the PDF go without drawing the rest (a Capture taken back). */
  release: () => void;
};

/** Whether `file` is a PDF, by its type or, without one, its name. */
export const isPdf = (file: File) =>
  file.type === PDF_TYPE || (!file.type && /\.pdf$/i.test(file.name));

/** A PDF's Free allowance check, as for an image. The server checks again. */
export function checkPdf(
  file: File,
  usedStorageBytes: number
): ImageRefusal | undefined {
  const allowed = isFileWithinAllowance({
    fileBytes: file.size,
    usedStorageBytes,
  });
  return allowed.ok ? undefined : allowed.reason;
}

const THUMBNAIL_WIDTH = 720;

type Pdfjs = typeof PdfjsModule;
let pdfjs: Promise<Pdfjs> | undefined;

/** pdf.js, loaded only when a PDF is Captured (like heic-to), its worker beside it. */
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = workerUrl;
    return module;
  });
  // A failed load (offline) may be tried again on the next Capture.
  pdfjs.catch(() => (pdfjs = undefined));
  return pdfjs;
}

type Document = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

/** One page on a canvas PAGE_IMAGE.width wide (a tall page fits PAGE_IMAGE.maxSide). */
async function draw(doc: Document, number: number) {
  const page = await doc.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      PAGE_IMAGE.width / base.width,
      PAGE_IMAGE.maxSide / base.height
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    page.cleanup();
  }
}

/** A page as a JPEG within PAGE_IMAGE.maxBytes, lowering the quality for busy pages. */
async function pageImage(canvas: HTMLCanvasElement): Promise<PageImage> {
  const bitmap = await createImageBitmap(canvas);
  try {
    for (const quality of [0.8, 0.6, 0.45]) {
      const blob = await encode(bitmap, PAGE_IMAGE.mime, quality);
      if (blob.size <= PAGE_IMAGE.maxBytes) {
        return { blob, width: canvas.width, height: canvas.height };
      }
    }
    throw "unreadable" satisfies ImageRefusal;
  } finally {
    bitmap.close();
    // Frees the canvas's memory now, not at the next collection (phones).
    canvas.width = canvas.height = 0;
  }
}

/**
 * Opens `file` with pdf.js and draws its first page: the thumbnail,
 * ThumbHash, palette and page count, so the Memory can land on the wall at
 * once. The other Indexed pages are drawn by `pageImages()`, while it
 * uploads. Rejects with "unreadable" (not a PDF, a password, a broken file)
 * or "file_too_large".
 */
export async function preparePdf(file: File): Promise<PreparedPdf> {
  if (file.size > FREE_ALLOWANCE.maxUploadBytes) {
    throw "file_too_large" satisfies ImageRefusal;
  }
  const { getDocument } = await loadPdfjs().catch(() => {
    throw "unreadable" satisfies ImageRefusal;
  });
  const [contentHash, data] = await Promise.all([
    sha256(file),
    file.arrayBuffer(),
  ]);
  const task = getDocument({ data: new Uint8Array(data) });
  let doc: Document;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    throw "unreadable" satisfies ImageRefusal;
  }
  try {
    const first = await draw(doc, 1);
    const bitmap = await createImageBitmap(first);
    let summary;
    let thumbnail: Blob;
    try {
      summary = summaryOf(bitmap);
      thumbnail = await encode(
        bitmap,
        "image/webp",
        0.8,
        Math.min(1, THUMBNAIL_WIDTH / bitmap.width)
      );
    } finally {
      bitmap.close();
    }
    const { width, height } = first;
    const firstImage = pageImage(first);
    // Awaited by pageImages(); a Capture taken back first never asks.
    firstImage.catch(() => {});
    const count = indexedPages(doc.numPages);
    let drawn: Promise<PageImage[]> | undefined;
    const release = () => void task.destroy();
    return {
      file,
      contentHash,
      title: file.name.replace(/\.pdf$/i, "").trim() || null,
      pages: doc.numPages,
      width,
      height,
      ...summary,
      thumbnail,
      thumbnailMime:
        thumbnail.type === "image/webp" ? "image/webp" : "image/jpeg",
      pageImages: () =>
        (drawn ??= (async () => {
          try {
            const images = [await firstImage];
            for (let n = 2; n <= count; n++) {
              images.push(await pageImage(await draw(doc, n)));
            }
            return images;
          } catch {
            throw "unreadable" satisfies ImageRefusal;
          } finally {
            release();
          }
        })()),
      release,
    };
  } catch (error) {
    void task.destroy();
    throw error === "file_too_large"
      ? error
      : ("unreadable" satisfies ImageRefusal);
  }
}
