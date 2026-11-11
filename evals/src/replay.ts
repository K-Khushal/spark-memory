import { createHash } from "node:crypto";
import type { Provider } from "@spark/indexing";
import type { SampleMemory } from "./manifest";

const ZERO = { inputTokens: 0, outputTokens: 0 };
const key = (title: string) => title.normalize("NFKC").trim();

/** Up to two sentences, at most 300 characters: what a model would say of a text. */
export function summarise(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/.*?[.!?।](\s|$)/g) ?? [flat];
  let out = "";
  for (const s of sentences.slice(0, 2)) if ((out + s).length <= 300) out += s;
  return (out || flat.slice(0, 300)).trim();
}

/**
 * The keyless Provider: it answers Extraction with what the manifest records
 * for the Memory (an image by its bytes, a text by its title), so a CI run
 * measures search (keywords, typos, vectors, passages, fusion) and never
 * vision. Texts without a recorded extraction get a deterministic summary.
 */
export function replayProvider(
  memories: SampleMemory[],
  texts: Map<string, string>
): Provider {
  const images = new Map<string, NonNullable<SampleMemory["extraction"]>>();
  const titles = new Map<string, NonNullable<SampleMemory["extraction"]>>();
  for (const sample of memories) {
    const body = texts.get(sample.id);
    const found =
      sample.extraction ??
      (body !== undefined && {
        title: sample.title ?? "",
        description: summarise(body),
        ocrText: "",
        tags: sample.tags,
        language: sample.language,
      });
    if (!found) continue;
    if (sample.image) images.set(sample.image.contentHash, found);
    else if (sample.title) {
      if (titles.has(key(sample.title)))
        throw new Error(`two texts share the title of ${sample.id}`);
      titles.set(key(sample.title), found);
    }
  }
  return {
    name: "fake",
    model: "fake",
    async extract({ user, image }) {
      const hash =
        image && createHash("sha256").update(image.bytes).digest("hex");
      const title = /<title>\n([^\n]*)\n/.exec(user)?.[1];
      const found =
        (hash && images.get(hash)) ||
        (title && titles.get(key(title))) ||
        undefined;
      const output = found ?? {
        title: title ?? "Untitled",
        description: "",
        ocrText: "",
        tags: [],
        language: "und",
      };
      return { text: JSON.stringify({ entities: [], ...output }), usage: ZERO };
    },
  };
}
