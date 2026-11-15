import {
  CATEGORISING,
  CATEGORY_NAMES,
  chooseCategories,
  cosine,
  embeddingSpace,
  EMBEDDING,
  INDEXING,
  maxTokens,
  prototypeOf,
} from "@spark/core";
import { embedCostMicros, type Embedder } from "./embedder";
import { ProviderError } from "./provider";
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
const prototypeKey = (space: string, name: string) =>
  `${space}\0${CATEGORISING.version}\0${name}`;

/** At most one token a UTF-8 byte of what is sent, plus the question and the Category names. */
export const jevTokenEstimate = (text: string) =>
  maxTokens(text.slice(0, INDEXING.maxInputChars)) + 800;

export const jevCostMicros = (model: string, inputTokens: number) =>
  Math.ceil(
    (inputTokens * (INDEXING.pricesMicrosPerMTokens[model]?.[0] ?? 0)) /
      1_000_000
  );

/**
 * A hold on one billable call's cost, taken right before the call: the
 * call's cost goes to `record` with `reservation`, which settles it; a hold
 * the call did not use is given back with `release` (safe after settling).
 */
export type CallHold = {
  reservation?: string;
  release: () => Promise<void>;
};

/** Up to this many Category prototypes are embedded in one call. */
const prototypeHold = (embedder: Embedder, names: readonly string[]) =>
  embedCostMicros(embedder.model, {
    textTokens: names.reduce(
      (n, name) =>
        n + Math.min(maxTokens(prototypeOf(name)), EMBEDDING.maxInputTokens),
      0
    ),
    imageTokens: 0,
  });

/**
 * Up to three Categories for one Memory, or undefined when none could be
 * decided now (budget spent, Memory changed, every method failed): the
 * Memory then keeps its old ones and is tried again later.
 *
 * `allow` is asked right before each outside call: it is false once the
 * run has moved on or AI opt-out is on, so nothing is sent for it. `hold`
 * is asked only when a billable call is about to be made (never to look),
 * with that call's cost as an upper bound; no hold (budget, or the share
 * spent) means no call, and the Memory is tried again later. Jev, when configured, goes first; if it fails
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
  hold,
  record,
  loadPrototypes,
  savePrototypes,
}: {
  loadPrototypes?: (
    space: string,
    names: readonly string[]
  ) => Promise<Record<string, number[]>>;
  savePrototypes?: (
    space: string,
    vectors: Record<string, number[]>
  ) => Promise<void>;
  text: string;
  /** The Memory's Overview vector, in `embedder`'s space. */
  vector: number[];
  embedder: Embedder;
  jev?: CategoryClient;
  /** The owner's own Category names, beside the built-ins and no one else's. */
  own?: readonly string[];
  allow: () => Promise<boolean>;
  hold: (micros: number) => Promise<CallHold | undefined>;
  record: (
    call: Pick<
      AiCall,
      | "provider"
      | "model"
      | "usage"
      | "costMicros"
      | "estimated"
      | "reservation"
    >
  ) => Promise<void>;
}): Promise<string[] | undefined> {
  const names = [...CATEGORY_NAMES, ...own];
  const jevHold =
    jev && (await allow())
      ? await hold(jevCostMicros(jev.model, jevTokenEstimate(text)))
      : undefined;
  if (jev && jevHold) {
    let reply;
    // Jev's cost is always recorded against its hold (it may be billed even
    // when the call failed). The hold goes back only once that is recorded:
    // a record that fails leaves it to expire, never settled unrecorded.
    let recorded = true;
    const settle = (call: Parameters<typeof record>[0]) =>
      record({ ...call, reservation: jevHold.reservation }).then(
        () => true,
        () => false
      );
    try {
      reply = await jev.classify(text, names);
    } catch {
      // It may still have been billed: count the most it could have cost.
      const inputTokens = jevTokenEstimate(text);
      recorded = await settle({
        provider: "jev",
        model: jev.model,
        usage: { inputTokens, outputTokens: 0 },
        costMicros: jevCostMicros(jev.model, inputTokens),
        estimated: true,
      });
    }
    if (reply) {
      recorded = await settle({
        provider: "jev",
        model: jev.model,
        usage: { inputTokens: reply.inputTokens, outputTokens: 0 },
        costMicros: jevCostMicros(jev.model, reply.inputTokens),
      });
    }
    if (recorded) await jevHold.release().catch(() => {});
    if (reply) {
      // Warm the persisted fallback during ordinary Indexing, even when Jev
      // answered: the cron is intentionally unable to call any provider.
      if (savePrototypes)
        await prepareCategoryPrototypes({
          embedder,
          own,
          allow,
          hold,
          record,
          loadPrototypes,
          savePrototypes,
        }).catch(() => undefined);
      return chooseCategories(reply.scores, CATEGORISING.jevThreshold);
    }
  }
  const prepared = await prepareCategoryPrototypes({
    embedder,
    own,
    allow,
    hold,
    record,
    loadPrototypes,
    savePrototypes,
  });
  if (!prepared) return undefined;
  const scores = Object.fromEntries(
    names.map((name) => [name, cosine(vector, prepared[name] ?? [])])
  );
  return chooseCategories(scores, CATEGORISING.embeddingThreshold);
}

/** Prepare Category prototype vectors during ordinary Indexing or Category creation, never cron. */
export async function prepareCategoryPrototypes({
  embedder,
  own = [],
  allow,
  hold,
  record,
  loadPrototypes,
  savePrototypes,
}: Pick<
  Parameters<typeof categorise>[0],
  | "embedder"
  | "own"
  | "allow"
  | "hold"
  | "record"
  | "loadPrototypes"
  | "savePrototypes"
>): Promise<Record<string, number[]> | undefined> {
  const names = [...CATEGORY_NAMES, ...own];
  if (!(await allow())) return undefined;
  const space = embeddingSpace(embedder.model, embedder.dimensions);
  const stored = await loadPrototypes?.(space, names);
  if (prototypes.size + Object.keys(stored ?? {}).length > MAX_PROTOTYPES)
    prototypes.clear();
  for (const [name, vector] of Object.entries(stored ?? {}))
    prototypes.set(prototypeKey(space, name), vector);
  const missing = names.filter(
    (name) => !prototypes.has(prototypeKey(space, name))
  );
  try {
    if (missing.length) {
      if (!(await allow())) return undefined;
      // Held only now, right before the one call that bills.
      const held = await hold(prototypeHold(embedder, missing));
      if (!held) return undefined;
      let embedded;
      try {
        embedded = await embedder.embed(
          missing.map((name) => ({ text: prototypeOf(name) })),
          { timeoutMs: 10_000 }
        );
      } catch (error) {
        let recorded = true;
        if (error instanceof ProviderError && error.estimate) {
          // Lost after it was sent: it may be billed, so the most it could
          // have cost is recorded against the hold (not given back).
          const { inputTokens, imageTokens = 0 } = error.estimate;
          recorded = await record({
            provider: embedder.name,
            model: embedder.model,
            usage: { inputTokens, outputTokens: 0 },
            costMicros: embedCostMicros(embedder.model, {
              textTokens: Math.max(0, inputTokens - imageTokens),
              imageTokens,
            }),
            estimated: true,
            reservation: held.reservation,
          }).then(
            () => true,
            () => false
          );
        }
        // A hold that could not have been billed goes back. One whose cost
        // could not be recorded is kept: giving it back would settle it and
        // block a later reconciliation, so it expires on its own instead.
        if (recorded) await held.release().catch(() => {});
        throw error;
      }
      const { vectors, usage } = embedded;
      await record({
        provider: embedder.name,
        model: embedder.model,
        usage: {
          inputTokens: usage.textTokens + usage.imageTokens,
          outputTokens: 0,
        },
        costMicros: embedCostMicros(embedder.model, usage),
        reservation: held.reservation,
      });
      await held.release().catch(() => {});
      if (prototypes.size + missing.length > MAX_PROTOTYPES) prototypes.clear();
      missing.forEach((name, i) =>
        prototypes.set(prototypeKey(space, name), vectors[i] ?? [])
      );
    }
  } catch {
    return undefined;
  }
  const unstored = names.filter((name) => !stored?.[name]);
  if (unstored.length)
    await savePrototypes?.(
      space,
      Object.fromEntries(
        unstored.map((name) => [
          name,
          prototypes.get(prototypeKey(space, name)) ?? [],
        ])
      )
    );
  return Object.fromEntries(
    names.map((name) => [name, prototypes.get(prototypeKey(space, name)) ?? []])
  );
}
