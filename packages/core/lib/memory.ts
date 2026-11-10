import { z } from "zod";
import { FREE_ALLOWANCE } from "./allowance";

/** What kind of thing a Memory is. See GLOSSARY.md → Memory. */
export const MEMORY_KINDS = [
  "text",
  "image",
  "link",
  "social_post",
  "video",
  "pdf",
  "file",
] as const;
export const MemoryKind = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** Whether Spark holds a Preserved copy. See GLOSSARY.md → Preservation. */
export const PRESERVATIONS = ["preserved", "reference_only"] as const;
export const Preservation = z.enum(PRESERVATIONS);
export type Preservation = z.infer<typeof Preservation>;

/** How far Indexing has got. See GLOSSARY.md → Index state. */
export const INDEX_STATES = ["indexing", "searchable", "failed"] as const;
export const IndexState = z.enum(INDEX_STATES);
export type IndexState = z.infer<typeof IndexState>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

/** A text Capture (paste or paste box). `id` lets clients insert optimistically and retry safely. */
export const TextCapture = z.object({
  id: z.uuid().optional(),
  body: z.string().trim().min(1).max(FREE_ALLOWANCE.textMaxChars),
  title: optionalText(FREE_ALLOWANCE.titleMaxChars),
  captureNote: optionalText(FREE_ALLOWANCE.captureNoteMaxChars),
});
export type TextCapture = z.input<typeof TextCapture>;

/** An edit from Memory detail. Omitted fields stay as they are; empty title or note clears it. */
export const MemoryEdit = TextCapture.omit({ id: true }).partial();
export type MemoryEdit = z.input<typeof MemoryEdit>;

/** An edit as clients send it: with the revision it was based on, so a late one is refused. */
export const MemoryEditRequest = MemoryEdit.extend({
  revision: z.number().int().positive().optional(),
});
export type MemoryEditRequest = z.input<typeof MemoryEditRequest>;

/**
 * Image types Spark keeps as the Preserved copy. HEIC and HEIF are converted
 * to JPEG in the browser, so they never reach the server.
 */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;
export const ImageType = z.enum(IMAGE_TYPES);
export type ImageType = z.infer<typeof ImageType>;

/** Thumbnails are WebP, or JPEG where the browser cannot write WebP. */
export const THUMBNAIL_TYPES = ["image/webp", "image/jpeg"] as const;
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;

const side = z.number().int().positive().max(100_000);

/**
 * An image Capture as the browser describes it before uploading: the Memory
 * is created from this, then the files go straight to storage. A retry with
 * the same `id` finds the same Memory. `contentHash` is the SHA-256 (hex) of
 * the Preserved copy, kept for duplicate detection later.
 */
export const ImageCapture = z.object({
  id: z.uuid(),
  mime: ImageType,
  bytes: z.number().int().positive().max(FREE_ALLOWANCE.maxUploadBytes),
  width: side,
  height: side,
  contentHash: z.string().regex(/^[\da-f]{64}$/),
  /** ThumbHash (base64): the blurred placeholder shown while a tile loads. */
  thumbhash: z.string().regex(/^[A-Za-z0-9+/]{4,64}={0,2}$/),
  thumbnail: z.object({
    mime: z.enum(THUMBNAIL_TYPES),
    bytes: z.number().int().positive().max(THUMBNAIL_MAX_BYTES),
  }),
});
export type ImageCapture = z.input<typeof ImageCapture>;
