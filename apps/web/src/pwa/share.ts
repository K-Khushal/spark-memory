import { IMAGE_TYPES, linkFromPaste } from "@spark/core";
import type { PendingShare } from "./hold";

/** What Capture should do with a share. Files win over text and URLs. */
export type SharePlan = {
  images: File[];
  pdfs: File[];
  other: File[];
  link?: string;
  text?: string;
};

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i;
const EXTRA_IMAGE_TYPES = new Set([
  "image/jpg",
  "image/pjpeg",
  "image/heic",
  "image/heif",
]);

function isImage(file: File): boolean {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return true;
  if (EXTRA_IMAGE_TYPES.has(file.type)) return true;
  return !file.type && IMAGE_NAME.test(file.name);
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function textBody({ title, text }: PendingShare): string {
  const heading = title.trim();
  const body = text.trim();
  if (!heading) return body;
  if (!body) return heading;
  if (body.startsWith(heading) || heading.startsWith(body)) {
    return body.length >= heading.length ? body : heading;
  }
  return `${heading}\n${body}`;
}

/** The URL Chrome put in `url`, or in `text` (often instead of `url`). */
export function linkFromShare(share: PendingShare): string | undefined {
  const url = share.url.trim();
  if (linkFromPaste(url)) return url;
  const text = share.text.trim();
  if (linkFromPaste(text)) return text;
  const title = share.title.trim();
  if (title && text.startsWith(title)) {
    const rest = text.slice(title.length).trim();
    if (linkFromPaste(rest)) return rest;
  }
  return undefined;
}

export function planShare(share: PendingShare): SharePlan {
  const images: File[] = [];
  const pdfs: File[] = [];
  const other: File[] = [];
  for (const file of share.files) {
    if (isImage(file)) images.push(file);
    else if (isPdf(file)) pdfs.push(file);
    else other.push(file);
  }
  if (images.length || pdfs.length || other.length) {
    return { images, pdfs, other };
  }
  const link = linkFromShare(share);
  if (link) return { images, pdfs, other, link };
  const text = textBody(share);
  return { images, pdfs, other, text: text || undefined };
}

/** The part of the Library a share needs. */
export type ShareLibrary = {
  capture: (text: string) => boolean;
  captureImages: (files: File[]) => Promise<void>;
};

export async function applyShare(
  plan: SharePlan,
  library: ShareLibrary,
  notify: (message: string) => void
) {
  if (plan.pdfs.length) notify("PDFs Can't Be Captured Yet");
  if (plan.other.length) notify("This Can't Be Captured");
  if (plan.images.length) {
    await library.captureImages(plan.images);
    return;
  }
  if (plan.link) {
    library.capture(plan.link);
    return;
  }
  if (plan.text) library.capture(plan.text);
}
