import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const EVALS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What Indexing would find in an image, recorded so a keyless run can replay it. */
const Extraction = z.object({
  title: z.string(),
  description: z.string(),
  ocrText: z.string(),
  tags: z.array(z.string()),
  language: z.string(),
});

/**
 * One Memory of the sample Library. Text lives in `text` (a file next to the
 * manifest), an image in `file`, with what Capture works out in the browser.
 * The owner's own Memories (#10) go in another `library/*.json` of the same shape.
 */
const Sample = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.enum(["text", "image"]),
  title: z.string().optional(),
  captureNote: z.string().optional(),
  text: z.string().optional(),
  file: z.string().optional(),
  image: z
    .object({
      mime: z.enum(["image/jpeg", "image/png"]),
      bytes: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      contentHash: z.string(),
      thumbhash: z.string(),
      palette: z.array(z.string()),
    })
    .optional(),
  tags: z.array(z.string()),
  language: z.string(),
  source: z.object({
    type: z.enum(["wikipedia", "commons", "gutenberg", "original", "owner"]),
    url: z.string(),
    licence: z.string(),
    licenceUrl: z.string().optional(),
    attribution: z.string(),
  }),
  extraction: Extraction.optional(),
});
export type SampleMemory = z.infer<typeof Sample>;

/**
 * One vague search: what the owner would type, and the Memories that count
 * as right (any one of them). `kind` names what makes it hard.
 */
const Search = z.object({
  id: z.string(),
  query: z.string().min(1),
  expect: z.array(z.string()).min(1),
  kind: z.string(),
  note: z.string().optional(),
});
export type SearchCase = z.infer<typeof Search>;

const jsonFiles = async (dir: string) =>
  (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();

const readAll = async <T>(dir: string, schema: z.ZodType<T>) =>
  (
    await Promise.all(
      (await jsonFiles(dir)).map(async (f) =>
        z.array(schema).parse(JSON.parse(await readFile(join(dir, f), "utf8")))
      )
    )
  ).flat();

/** Every `library/*.json` and `searches/*.json`, checked against each other. */
export async function loadSet(root = EVALS_ROOT) {
  const memories = await readAll(join(root, "library"), Sample);
  const searches = await readAll(join(root, "searches"), Search);
  const ids = new Set(memories.map((i) => i.id));
  if (ids.size !== memories.length) throw new Error("two Memories share an id");
  const searchIds = new Set(searches.map((s) => s.id));
  if (searchIds.size !== searches.length)
    throw new Error("two searches share an id");
  for (const s of searches) {
    for (const id of s.expect) {
      if (!ids.has(id))
        throw new Error(`search ${s.id} expects unknown Memory ${id}`);
    }
  }
  return { memories, searches };
}

/**
 * Experiments and comparisons send the whole sample Library to outside
 * services. The sample is openly licensed; the owner's own Memories (#10)
 * may be personal, so a run that would send them stops unless allowed.
 */
export function refuseOwnerMemories(memories: SampleMemory[], what: string) {
  if (process.argv.includes("--include-owner")) return;
  if (memories.some((m) => m.source.type === "owner")) {
    throw new Error(
      `${what} would send the owner's own Memories to an outside service: pass --include-owner if that is intended`
    );
  }
}

/** The Memory's text or image bytes from library/. */
export const readLibraryFile = (path: string, root = EVALS_ROOT) =>
  readFile(join(root, "library", path));
