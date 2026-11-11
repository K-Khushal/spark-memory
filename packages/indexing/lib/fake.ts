import type { Embedder } from "./embedder";
import type { Provider } from "./provider";

/** A word only the fake provider writes, so a test can find a Memory by it. */
export const FAKE_WORD = "quillfeather";

/**
 * A stand-in provider for local development and the smoke test, chosen with
 * INDEXING_PROVIDER=fake: no keys, no network, nothing leaves the machine.
 * Content containing "fake:fail" gets an answer that is not JSON, every
 * time: the corrective retry fails too, so the Memory shows Failed at once.
 */
export function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake",
    async extract({ user, image }) {
      if (user.includes("fake:fail")) {
        return { text: "not json", usage: { inputTokens: 0, outputTokens: 0 } };
      }
      const text = /<text>\n([^\n]*)/.exec(user)?.[1]?.trim();
      const output = {
        title: image ? "Fake Image Title" : (text?.slice(0, 60) ?? "Untitled"),
        description: `Described locally by the fake provider: ${FAKE_WORD}.`,
        ocrText: "",
        entities: [],
        tags: ["fake"],
        language: "en",
      };
      return {
        text: JSON.stringify(output),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

/**
 * Words the fake embedder reads as one meaning, so local development and
 * the smoke test can find a Memory by words it does not contain.
 */
export const FAKE_MEANINGS: Record<string, string> = {
  dusk: "evening",
  sunset: "evening",
  twilight: "evening",
  port: "harbour",
  harbor: "harbour",
  dock: "harbour",
};

/** The prompt's own words and the fake provider's, which say nothing about a Memory. */
const IGNORED = new Set([
  ...["task", "search", "result", "query", "title", "text", "none", "fake"],
  ...["described", "locally", "by", "the", "provider", FAKE_WORD],
]);

/** A unit-length pseudo-random direction, the same for the same seed. */
function direction(seed: string, dimensions: number) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const v = Array.from({ length: dimensions }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return ((h >>> 0) / 2 ** 32) * 2 - 1;
  });
  return normalise(v);
}

function normalise(v: number[]) {
  const length = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / length);
}

/**
 * A stand-in embedder (INDEXING_PROVIDER=fake): each word is a fixed random
 * direction and words in FAKE_MEANINGS share one, so texts about the same
 * thing point the same way and unrelated ones are nearly orthogonal. An
 * image points by its bytes. No keys, no network.
 */
export function fakeEmbedder(dimensions = 768): Embedder {
  return {
    name: "fake",
    model: "fake-embedding",
    dimensions,
    async embed(inputs) {
      const vectors = inputs.map((input) => {
        if ("image" in input) {
          let sum = 0;
          for (const b of input.image.bytes) sum = (sum * 31 + b) | 0;
          return direction(`image:${sum}`, dimensions);
        }
        const words = input.text
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 1 && !IGNORED.has(w));
        // Nothing to say still points somewhere (a zero vector has no angle).
        if (!words.length) return direction("", dimensions);
        const total = new Array<number>(dimensions).fill(0);
        for (const word of words) {
          const d = direction(FAKE_MEANINGS[word] ?? word, dimensions);
          for (let i = 0; i < dimensions; i++) total[i]! += d[i]!;
        }
        return normalise(total);
      });
      return { vectors, usage: { textTokens: 0, imageTokens: 0 } };
    },
  };
}
