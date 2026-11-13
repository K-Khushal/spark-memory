import {
  CATEGORISING,
  CATEGORY_NAMES,
  chooseCategories,
  cosine,
  INDEXING,
  prototypeOf,
} from "@spark/core";
import { embedCostMicros, type Embedder } from "./embedder";
import type { AiCall } from "./indexer";

/** The third-party seam (ADR-0008): tests fake it, `jevCategories` is the real one. */
export type CategoryClient = {
  model: string;
  /** Probabilities per Category. Throws when unavailable, slow or invalid. */
  classify(
    text: string,
    categories: readonly string[]
  ): Promise<{
    scores: Record<string, number>;
    inputTokens: number;
  }>;
};

/**
 * Prototype vectors by embedding space and name: the same ones serve every
 * Memory (and every person who has a Category of that name).
 */
const prototypes = new Map<string, number[]>();
const MAX_PROTOTYPES = 2000;
const prototypeKey = (space: string, name: string) => `${space}\0${name}`;

/** About three characters a token, plus the question and the Category names. */
export const jevTokenEstimate = (text: string) =>
  Math.ceil(Math.min(text.length, INDEXING.maxInputChars) / 3) + 800;

export const jevCostMicros = (model: string, inputTokens: number) =>
  Math.ceil(
    (inputTokens * (INDEXING.pricesMicrosPerMTokens[model]?.[0] ?? 0)) /
      1_000_000
  );

/**
 * Up to three Categories for one Memory, or undefined when none could be
 * decided now (budget spent, Memory changed, every method failed): the
 * Memory then keeps its old ones and is tried again later.
 *
 * `allow` is asked right before each outside call: it is false once the
 * run has moved on, AI opt-out is on or the daily budget is spent, so
 * nothing is sent for it. Jev, when configured, goes first; if it fails
 * once (no retry), the Memory's own embedding is compared with the
 * Categories' prototypes instead.
 */
export async function categorise({
  text,
  vector,
  embedder,
  jev,
  own = [],
  allow,
  record,
}: {
  text: string;
  /** The Memory's Overview vector, in `embedder`'s space. */
  vector: number[];
  embedder: Embedder;
  jev?: CategoryClient;
  /** The owner's own Category names, beside the built-ins and no one else's. */
  own?: readonly string[];
  allow: () => Promise<boolean>;
  record: (
    call: Pick<
      AiCall,
      "provider" | "model" | "usage" | "costMicros" | "estimated"
    >
  ) => Promise<void>;
}): Promise<string[] | undefined> {
  const names = [...CATEGORY_NAMES, ...own];
  if (jev && (await allow())) {
    let reply;
    try {
      reply = await jev.classify(text, names);
    } catch {
      // It may still have been billed: count the most it could have cost.
      const inputTokens = jevTokenEstimate(text);
      await record({
        provider: "jev",
        model: jev.model,
        usage: { inputTokens, outputTokens: 0 },
        costMicros: jevCostMicros(jev.model, inputTokens),
        estimated: true,
      }).catch(() => {});
    }
    if (reply) {
      await record({
        provider: "jev",
        model: jev.model,
        usage: { inputTokens: reply.inputTokens, outputTokens: 0 },
        costMicros: jevCostMicros(jev.model, reply.inputTokens),
      }).catch(() => {});
      return chooseCategories(reply.scores, CATEGORISING.jevThreshold);
    }
  }
  if (!(await allow())) return undefined;
  const space = `${embedder.model}:${embedder.dimensions}`;
  const missing = names.filter(
    (name) => !prototypes.has(prototypeKey(space, name))
  );
  try {
    if (missing.length) {
      const { vectors, usage } = await embedder.embed(
        missing.map((name) => ({ text: prototypeOf(name) })),
        { timeoutMs: 10_000 }
      );
      await record({
        provider: embedder.name,
        model: embedder.model,
        usage: {
          inputTokens: usage.textTokens + usage.imageTokens,
          outputTokens: 0,
        },
        costMicros: embedCostMicros(embedder.model, usage),
      });
      if (prototypes.size + missing.length > MAX_PROTOTYPES) prototypes.clear();
      missing.forEach((name, i) =>
        prototypes.set(prototypeKey(space, name), vectors[i] ?? [])
      );
    }
  } catch {
    return undefined;
  }
  const scores = Object.fromEntries(
    names.map((name) => [
      name,
      cosine(vector, prototypes.get(prototypeKey(space, name)) ?? []),
    ])
  );
  return chooseCategories(scores, CATEGORISING.embeddingThreshold);
}
