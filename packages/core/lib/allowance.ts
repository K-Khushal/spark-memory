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
  /**
   * Past the daily Captures, links and text are still kept (partly Indexed)
   * up to this many more a UTC day, then refused like any Capture.
   */
  keptPerDay: 50,
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

/** Why a file does not fit: too big, or no storage left. */
export type FileRefusal = "file_too_large" | "storage_full";

/** Why a Capture of a file is refused: `captures_full` is the daily limit, which resets at midnight UTC. */
export type CaptureRefusal = FileRefusal | "captures_full";

export function isFileWithinAllowance(input: {
  fileBytes: number;
  usedStorageBytes: number;
}): { ok: true } | { ok: false; reason: FileRefusal } {
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

/** Whether one more Capture fits in today's allowance, given those already taken today. */
export const isCaptureWithinAllowance = (capturedToday: number) =>
  capturedToday < FREE_ALLOWANCE.capturesPerDay;

/** One counted limit, as Settings shows it. */
export type Meter = { used: number; limit: number };

/** What the person has used of the Free allowance: storage, and today's Captures and Deep fetches. */
export type AllowanceUsage = {
  storage: Meter;
  captures: Meter;
  deepFetches: Meter;
  /** When today's counts start again (the next UTC midnight), ISO. */
  resetsAt: string;
};

export function allowanceUsage(
  used: { storageBytes: number; captures: number; deepFetches: number },
  now: Date
): AllowanceUsage {
  return {
    storage: { used: used.storageBytes, limit: FREE_ALLOWANCE.storageBytes },
    captures: { used: used.captures, limit: FREE_ALLOWANCE.capturesPerDay },
    deepFetches: {
      used: used.deepFetches,
      limit: FREE_ALLOWANCE.deepFetchesPerDay,
    },
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    ).toISOString(),
  };
}

/** Bytes in words, the way copy names a limit: "25 MB", "1 GB", "1.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = "KB";
  for (const next of units) {
    unit = next;
    if (value < 1024 || next === "GB") break;
    value /= 1024;
  }
  const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}
