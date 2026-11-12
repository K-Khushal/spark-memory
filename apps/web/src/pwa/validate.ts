import { FREE_ALLOWANCE, IMAGE_TYPES } from "@spark/core";
import type { HeldFile, PendingShare } from "./hold";

/** Why a share is turned away before anything is stored. */
export type ShareRefusal =
  | "empty"
  | "too_long"
  | "too_large"
  | "too_many"
  | "unsupported"
  | "unreadable"
  | "storage"
  | "untrusted";

/** Most shares held at once, so nothing but the person fills the hold. */
export const MAX_HELD_SHARES = 10;

/** Most files one share may carry. */
export const MAX_SHARE_FILES = 10;

/** The most bytes a share can hold: every file at the limit, plus its text. */
export const MAX_SHARE_BYTES =
  MAX_SHARE_FILES * FREE_ALLOWANCE.maxUploadBytes +
  FREE_ALLOWANCE.textMaxChars * 4;

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i;
// HEIC is converted to JPEG in the browser (@spark/capture), so it is kept.
const EXTRA_IMAGE_TYPES = new Set([
  "image/jpg",
  "image/pjpeg",
  "image/heic",
  "image/heif",
]);

export function isImage(file: File): boolean {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return true;
  if (EXTRA_IMAGE_TYPES.has(file.type)) return true;
  return !file.type && IMAGE_NAME.test(file.name);
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

const kept = ({ file }: HeldFile) => isImage(file) || isPdf(file);

/** The first limit a share breaks, by the Free allowance; undefined when it fits. */
export function checkShare(share: PendingShare): ShareRefusal | undefined {
  const words = share.title.length + share.text.length + share.url.length;
  if (words > FREE_ALLOWANCE.textMaxChars) return "too_long";
  if (share.files.length > MAX_SHARE_FILES) return "too_many";
  if (!share.files.every(kept)) return "unsupported";
  if (share.files.some(({ file }) => file.size > FREE_ALLOWANCE.maxUploadBytes))
    return "too_large";
  if (!words && !share.files.length) return "empty";
  return undefined;
}
