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
} as const;

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
