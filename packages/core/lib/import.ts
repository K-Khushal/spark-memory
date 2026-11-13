import { z } from "zod";
import { FREE_ALLOWANCE } from "./allowance";
import { normaliseUrl, LINK_MAX_CHARS } from "./link";

/** Half the daily allowance stays available to fresh Captures. */
export const IMPORT_RESERVE = Math.ceil(FREE_ALLOWANCE.capturesPerDay / 2);

export const IMPORT_LIMITS = {
  bytes: 10 * 1024 * 1024,
  urls: 10_000,
  batch: 100,
} as const;
export const ImportItem = z.object({
  url: z
    .string()
    .max(LINK_MAX_CHARS)
    .refine((url) => !!normaliseUrl(url)),
  title: z.string().max(FREE_ALLOWANCE.titleMaxChars).optional(),
  captureNote: z.string().max(FREE_ALLOWANCE.captureNoteMaxChars).optional(),
  savedAt: z.iso.datetime().optional(),
});
export type ImportItem = z.infer<typeof ImportItem>;
export const ImportEntry = z.union([
  ImportItem,
  z.object({ imageId: z.uuid() }),
]);
export type ImportEntry = z.infer<typeof ImportEntry>;
export const ImportBatch = z.object({
  offset: z.number().int().min(0).max(IMPORT_LIMITS.urls),
  items: z.array(ImportEntry).min(1).max(IMPORT_LIMITS.batch),
});
export const ImportCreate = z.object({
  id: z.uuid(),
  total: z.number().int().min(1).max(IMPORT_LIMITS.urls),
  spread: z.boolean().default(true),
});
export const ImportAction = z.object({
  action: z.enum(["start", "pause", "resume", "cancel"]),
});
