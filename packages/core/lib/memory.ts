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
