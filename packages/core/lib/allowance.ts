const MB = 1024 * 1024;

/**
 * The Free allowance (GLOSSARY.md). One place for every limit, so plans can
 * change them later. Links beyond it are kept as Reference only; files beyond
 * it are refused with a reason.
 */
export const FREE_ALLOWANCE = {
  storageBytes: 1024 * MB,
  maxUploadBytes: 25 * MB,
  capturesPerDay: 100,
  pdfPagesIndexed: 30,
  videoTranscriptMaxMinutes: 60,
  deepFetchesPerDay: 20,
  /** Longest text Memory body, in characters (about 25 pages). */
  textMaxChars: 100_000,
  titleMaxChars: 300,
  captureNoteMaxChars: 500,
} as const;

/**
 * Image types Spark keeps as the Preserved copy. HEIC and HEIF are converted
 * to JPEG in the browser, so they never reach the server. Here, free of zod,
 * so the service worker can check types without bundling the schemas.
 */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export function isFileWithinAllowance(input: {
  fileBytes: number;
  usedStorageBytes: number;
}): { ok: true } | { ok: false; reason: "file_too_large" | "storage_full" } {
  if (input.fileBytes > FREE_ALLOWANCE.maxUploadBytes) {
    return { ok: false, reason: "file_too_large" };
  }
  if (input.usedStorageBytes + input.fileBytes > FREE_ALLOWANCE.storageBytes) {
    return { ok: false, reason: "storage_full" };
  }
  return { ok: true };
}

/** Plans a user can be on. Only Free exists for now; paid plans come later. */
export const PLANS = ["free"] as const;
export type Plan = (typeof PLANS)[number];
export const DEFAULT_PLAN: Plan = "free";
