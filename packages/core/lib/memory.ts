import { z } from "zod";
import { FREE_ALLOWANCE } from "./allowance";
import { Palette } from "./indexing";

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
  /**
   * True only when this browser allows product events (Do Not Track is off).
   * Omitted or false: Indexing does not report time to Searchable.
   */
  productAnalytics: z.boolean().optional(),
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

/** Switches AI opt-out (GLOSSARY.md) on or off for one Memory. */
export const AiOptOut = z.object({ aiOptOut: z.boolean() });
export type AiOptOut = z.infer<typeof AiOptOut>;

/** Account deletion is confirmed by typing the account's email address. */
export const AccountDeletion = z.object({ email: z.string().max(320) });
export type AccountDeletion = z.infer<typeof AccountDeletion>;

/** Whether `typed` confirms deleting the account of `email` (spaces and case aside). */
export const confirmsDeletion = (typed: string, email: string) =>
  typed.trim().toLowerCase() === email.toLowerCase();

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
  /** Not capped here: the Free allowance check refuses it with its reason. */
  bytes: z.number().int().positive(),
  width: side,
  height: side,
  contentHash: z.string().regex(/^[\da-f]{64}$/),
  /** ThumbHash (base64): the blurred placeholder shown while a tile loads. */
  thumbhash: z.string().regex(/^[A-Za-z0-9+/]{4,64}={0,2}$/),
  /** Dominant colours, worked out in the browser while it decodes the image. */
  palette: Palette.optional(),
  thumbnail: z.object({
    mime: z.enum(THUMBNAIL_TYPES),
    bytes: z.number().int().positive().max(THUMBNAIL_MAX_BYTES),
  }),
  /** Same choice as a text Capture: time to Searchable is sent only when true. */
  productAnalytics: z.boolean().optional(),
});
export type ImageCapture = z.input<typeof ImageCapture>;

/** The one type a PDF Memory is kept as. */
export const PDF_TYPE = "application/pdf";

/**
 * Page images: the first pages of a PDF, drawn in the browser at Capture
 * (Workers cannot draw them cheaply), for Visual vectors, for a scan's
 * text, and for the viewer. JPEG, because every model reads it.
 */
export const PAGE_IMAGE = {
  mime: "image/jpeg",
  /** Drawn this wide (taller pages keep their shape, up to `maxSide`). */
  width: 1024,
  maxSide: 2048,
  /**
   * Small enough that all 30 Indexed pages, base64 in one Gemini request,
   * stay well inside its inline limit (INDEXING.inlineRequestBytes).
   */
  maxBytes: 400 * 1024,
} as const;

/** How many pages of a PDF of `pages` are Indexed (the Free allowance). */
export const indexedPages = (pages: number) =>
  Math.min(pages, FREE_ALLOWANCE.pdfPagesIndexed);

/** A PDF longer than the Free allowance indexes: shown as Partly Indexed. */
export const isPartlyIndexed = (pages: number | null | undefined) =>
  !!pages && pages > FREE_ALLOWANCE.pdfPagesIndexed;

/**
 * A PDF Capture as the browser describes it before uploading, like an
 * image Capture: the PDF itself, its thumbnail (the first page), and an
 * image of each page that is Indexed, in order.
 */
export const PdfCapture = z
  .object({
    id: z.uuid(),
    /** Not capped here: the Free allowance check refuses it with its reason. */
    bytes: z.number().int().positive(),
    contentHash: z.string().regex(/^[\da-f]{64}$/),
    /** The file's name without `.pdf`, as the Memory's title. */
    title: optionalText(FREE_ALLOWANCE.titleMaxChars),
    pages: z.number().int().positive().max(100_000),
    /** The first page's shape, for the wall. */
    width: side,
    height: side,
    thumbhash: z.string().regex(/^[A-Za-z0-9+/]{4,64}={0,2}$/),
    palette: Palette.optional(),
    thumbnail: z.object({
      mime: z.enum(THUMBNAIL_TYPES),
      bytes: z.number().int().positive().max(THUMBNAIL_MAX_BYTES),
    }),
    pageImages: z
      .array(
        z.object({
          bytes: z.number().int().positive().max(PAGE_IMAGE.maxBytes),
          width: side,
          height: side,
        })
      )
      .min(1)
      .max(FREE_ALLOWANCE.pdfPagesIndexed),
    productAnalytics: z.boolean().optional(),
  })
  .refine((c) => c.pageImages.length === indexedPages(c.pages), {
    message: "one page image for each Indexed page",
    path: ["pageImages"],
  });
export type PdfCapture = z.input<typeof PdfCapture>;
