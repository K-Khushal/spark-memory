import { linkFromPaste } from "@spark/core";
import type { HeldFile, PendingShare } from "./hold";
import { isImage, isPdf } from "./validate";

/** What Capture should do with a share. Files win over text and URLs. */
export type SharePlan = {
  /** The Capture id of the link or text. */
  id: string;
  images: HeldFile[];
  pdfs: HeldFile[];
  link?: string;
  text?: string;
};

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
  const images = share.files.filter(({ file }) => isImage(file));
  const pdfs = share.files.filter(({ file }) => isPdf(file));
  const plan = { id: share.id, images, pdfs };
  if (images.length || pdfs.length) return plan;
  const link = linkFromShare(share);
  if (link) return { ...plan, link };
  return { ...plan, text: textBody(share) || undefined };
}

/**
 * How a Capture ended. Only these end it: a failed one stays open, and Try
 * Again on its toast can still finish it.
 */
export type CaptureOutcome = "stored" | "refused" | "dropped";

/** The part of the Library a share needs. Each id is the Memory's id. */
export type ShareLibrary = {
  /** Resolves once the server has the text or link, or Capture refused it. */
  captureShared: (text: string, id: string) => Promise<CaptureOutcome>;
  /** One outcome per file, once each is stored on the server or refused. */
  captureSharedImages: (files: HeldFile[]) => Promise<CaptureOutcome[]>;
};

/**
 * Captures a share and resolves when the server has every part of it, which
 * is when the hold may let it go.
 */
export async function applyShare(
  plan: SharePlan,
  library: ShareLibrary,
  notify: (message: string) => void
): Promise<void> {
  if (plan.pdfs.length) notify("PDFs Can't Be Captured Yet");
  if (plan.images.length) {
    await library.captureSharedImages(plan.images);
    return;
  }
  const text = plan.link ?? plan.text;
  if (text) await library.captureShared(text, plan.id);
}
