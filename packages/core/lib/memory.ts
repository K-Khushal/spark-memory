import { z } from "zod";

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
