import {
  CATEGORISING,
  CATEGORY_NAMES,
  chooseCategories,
  cosine,
  INDEXING,
  type Category,
} from "@spark/core";
import { embedCostMicros, type Embedder } from "./embedder";
import type { AiCall } from "./indexer";

/** The third-party seam (ADR-0008): tests fake it, `jevCategories` is the real one. */
export type CategoryClient = {
  model: string;
  /** Probabilities per Category. Throws when unavailable, slow or invalid. */
  classify(
    text: string,
    categories: readonly Category[]
  ): Promise<{
    scores: Partial<Record<Category, number>>;
    inputTokens: number;
  }>;
};

/** Prototype vectors by embedding space: the same ones serve every Memory. */
const prototypes = new Map<string, number[][]>();

/** About three characters a token, plus the question and the Category names. */
export const jevTokenEstimate = (text: string) =>
  Math.ceil(Math.min(text.length, INDEXING.maxInputChars) / 3) + 800;

const jevCostMicros = (model: string, inputTokens: number) =>
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
  allow,
  record,
}: {
  text: string;
  /** The Memory's Overview vector, in `embedder`'s space. */
  vector: number[];
  embedder: Embedder;
  jev?: CategoryClient;
  allow: () => Promise<boolean>;
  record: (
    call: Pick<
      AiCall,
      "provider" | "model" | "usage" | "costMicros" | "estimated"
    >
  ) => Promise<void>;
}): Promise<Category[] | undefined> {
  if (jev && (await allow())) {
    let reply;
    try {
      reply = await jev.classify(text, CATEGORY_NAMES);
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
  let known = prototypes.get(space);
  try {
    if (!known) {
      const { vectors, usage } = await embedder.embed(
        CATEGORY_NAMES.map((name) => ({ text: CATEGORISING.prototypes[name] })),
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
      prototypes.set(space, (known = vectors));
    }
  } catch {
    return undefined;
  }
  const scores = Object.fromEntries(
    CATEGORY_NAMES.map((name, i) => [name, cosine(vector, known[i] ?? [])])
  );
  return chooseCategories(scores, CATEGORISING.embeddingThreshold);
}
