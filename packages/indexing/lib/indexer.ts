import {
  EMBEDDING,
  embeddingSpace,
  INDEXING,
  IndexingOutput,
  type IndexFailure,
  type ProviderName,
} from "@spark/core";
import {
  embedCostMicros,
  embeddingInputs,
  type EmbedSource,
  type Embedder,
  type Embedding,
} from "./embedder";
import type { Gathered, Gatherer } from "./link/gather";
import { memoryPart, SYSTEM, type MemoryContent } from "./prompt";
import {
  ProviderError,
  type ExtractRequest,
  type Provider,
  type Usage,
} from "./provider";

/** Fresh Captures and Retry come first; edits and model changes wait (and pause past the budget). */
export type Priority = "fresh" | "background";

/**
 * One queue message's worth of work. `attempt` starts at 1. `run` and
 * `generation` are the run and the Memory it was sent for: a message for an
 * older run, or for an earlier Memory with the same id, does nothing.
 * `embed` makes only the vectors of a Searchable Memory again (a model
 * change, an edited title, or vectors an earlier run could not make).
 */
export type IndexJob = {
  memoryId: string;
  priority: Priority;
  attempt: number;
  run?: number;
  /** Absent in messages sent before generations were. */
  generation?: string;
  task?: "index" | "embed";
};

/**
 * The row a delivery took, as the store loaded it. Every write names it and
 * changes nothing once any part differs: the run moved on, or the Memory
 * was deleted and another saved with its id (a new generation, maybe
 * another owner's).
 */
export type Claim = {
  memoryId: string;
  userId: string;
  /** Set by the server when the row is created; never reused for the id. */
  generation: string;
  run: number;
};

/** A Memory waiting for Indexing, as the store loads it. `run` changes whenever Indexing restarts. */
export type PendingMemory = MemoryContent & {
  userId: string;
  generation: string;
  run: number;
  /** The text's revision, so vectors made from it are dropped once it is edited. */
  revision: number;
  aiOptOut: boolean;
  /** A link Memory: false until its Source has been gathered (once). */
  gathered?: boolean;
  /** Storage keys of an image Memory's files. */
  image?: {
    key: string;
    mime: string;
    bytes: number;
    thumbnailKey: string;
    thumbnailMime: string;
  };
};

type ImageKeys = NonNullable<PendingMemory["image"]>;
type Image = { bytes: Uint8Array; mime: string };

/** A Searchable Memory whose vectors are to be made again. */
export type EmbedMemory = EmbedSource & {
  userId: string;
  generation: string;
  run: number;
  revision: number;
  image?: ImageKeys;
};

/** A loaded Memory and the id it was loaded by. */
type Work = PendingMemory & { memoryId: string };

export type Extraction = { output: IndexingOutput; model: string };

/**
 * Where Indexing reads and writes. Every write names the Claim it loaded
 * and does nothing (returns false) once Indexing has moved on or the
 * Memory it loaded is gone.
 */
export type IndexStore = {
  /**
   * Takes the Memory for this delivery (a short lease, so a duplicate
   * delivery skips). Undefined when it is gone, not waiting for Indexing, at
   * another run than `run` or generation than `generation`, or taken.
   */
  load(
    memoryId: string,
    run?: number,
    generation?: string
  ): Promise<PendingMemory | undefined>;
  /** Gives the lease back for the next attempt. */
  release(claim: Claim): Promise<void>;
  /** Still this run, still without AI opt-out: asked before every provider call. */
  isCurrent(claim: Claim): Promise<boolean>;
  /**
   * Searchable; `extraction` is null for a Memory with AI opt-out. The
   * `embedding` is kept only if its revision is still current; without
   * one, the hourly sweep makes the vectors in the background.
   */
  complete(
    claim: Claim,
    extraction: Extraction | null,
    embedding?: Embedding
  ): Promise<boolean>;
  /**
   * Like `load`, for an `embed` job: a Searchable Memory without AI opt-out
   * whose vectors are not from `space` (`model@dimensions`) and its current
   * revision. Undefined otherwise, or when taken.
   */
  loadForEmbedding(
    memoryId: string,
    space: string,
    generation?: string
  ): Promise<EmbedMemory | undefined>;
  /** Still Searchable at the Claim's run and `revision`, without AI opt-out: asked before the call. */
  stillEmbeddable(claim: Claim, revision: number): Promise<boolean>;
  /** Replaces the vectors if nothing changed since loading; gives the lease back. */
  writeVectors(claim: Claim, embedding: Embedding): Promise<boolean>;
  fail(claim: Claim, reason: IndexFailure): Promise<boolean>;
  /**
   * Keeps what gathering a link found, once, if the Claim is still current:
   * its content as Extraction should now see it, else undefined.
   */
  saveGathered(
    claim: Claim,
    gathered: Omit<Gathered, "transient">
  ): Promise<
    | (Pick<
        PendingMemory,
        | "title"
        | "body"
        | "captureNote"
        | "sourceUrl"
        | "pageTitle"
        | "description"
      > & { gathered: boolean })
    | undefined
  >;
  spentTodayMicros(): Promise<number>;
  /** The effective daily budget (the admin's setting, or the config default). */
  dailyBudgetMicros(): Promise<number>;
  recordCall(call: AiCall): Promise<void>;
};

/** One AI call and what it cost, for the admin page and the budget. */
export type AiCall = {
  userId: string;
  /** Null for a search query's embedding. */
  memoryId: string | null;
  /** The Memory's generation, so the call names it even once the id is reused. */
  memoryGeneration?: string;
  provider: ProviderName;
  model: string;
  usage: Usage;
  costMicros: number;
  /** A guess: the call timed out, so no usage came back. */
  estimated?: boolean;
};

export type IndexOutcome =
  | { result: "searchable" | "skipped" }
  | { result: "failed"; reason: IndexFailure }
  /** Try the same message again after `delaySeconds` (counts as an attempt). */
  | { result: "retry"; delaySeconds: number }
  /** Over the daily budget: send it again after `delaySeconds` (not an attempt). */
  | { result: "paused"; delaySeconds: number };

class InvalidOutput extends Error {}
/** The run moved on (an edit, Retry or AI opt-out) before a provider call. */
class Superseded extends Error {}

const costMicros = (model: string, { inputTokens, outputTokens }: Usage) => {
  const [input, output] = INDEXING.pricesMicrosPerMTokens[model] ?? [0, 0];
  return Math.ceil((inputTokens * input + outputTokens * output) / 1_000_000);
};

/** Whose call it was, and which Memory: the one loaded, even if its id is reused since. */
const callOf = (claim: Claim) => ({
  userId: claim.userId,
  memoryId: claim.memoryId,
  memoryGeneration: claim.generation,
});

/** "/tags: expected array" style: paths and rules only, never the content. */
const describeIssues = (error: {
  issues: { path: PropertyKey[]; message: string }[];
}) =>
  error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join("; ");

function parse(text: string) {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false as const, errors: "not valid JSON" };
  }
  const parsed = IndexingOutput.safeParse(value);
  return parsed.success
    ? { ok: true as const, output: parsed.data }
    : { ok: false as const, errors: describeIssues(parsed.error) };
}

/**
 * Until the next UTC day, at most 12 hours; then it checks again. Queues
 * documents 24 hours as the most a message can be delayed
 * (docs/research/indexing-providers.md): 12 stays well inside it.
 */
const secondsToNextUtcDay = (now: Date) =>
  Math.min(
    12 * 3600,
    Math.ceil(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
        now.getTime()) /
        1000
    )
  );

/** 30 s, 60 s, 120 s… after each failed attempt. */
export const backoffSeconds = (attempt: number) =>
  Math.min(30 * 2 ** (attempt - 1), 3600);

/**
 * Indexing (GLOSSARY.md) behind one call: `index(job)` loads the Memory,
 * skips every AI step for AI opt-out, honours the daily budget for
 * background work, runs the provider chain with one corrective retry per
 * provider, and writes the result or the failure. The queue adapter turns
 * the outcome into ack, retry or a delayed resend.
 */
export function createIndexer({
  store,
  providers,
  embedder,
  gatherer,
  readFile,
  now = () => new Date(),
}: {
  store: IndexStore;
  /** In chain order (INDEXING.chain). */
  providers: Provider[];
  /** Gathers a link's Source; without one, links are found by their URL and note. */
  gatherer?: Gatherer;
  /** Makes the vectors; without one, Memories are found by keyword only. */
  embedder?: Embedder;
  /** An object's bytes from storage; undefined when it is not there. */
  readFile: (key: string) => Promise<Uint8Array | undefined>;
  now?: () => Date;
}) {
  /**
   * Records a call that already happened. If that fails (the database), the
   * answer already paid for is still used: retrying would pay again. Only
   * the category is logged.
   */
  const recordCall = (call: AiCall) =>
    store
      .recordCall(call)
      .catch(() => console.error("indexing: AI call cost not recorded"));

  /** One provider call for the Memory loaded as `memoryId`, recorded with its cost. */
  async function ask(provider: Provider, work: Work, request: ExtractRequest) {
    // AI opt-out switched on (or an edit, or Retry) since loading: stop here.
    if (!(await store.isCurrent(work))) throw new Superseded();
    let reply;
    try {
      reply = await provider.extract(request);
    } catch (error) {
      if (error instanceof ProviderError && error.estimate) {
        await recordCall({
          ...callOf(work),
          provider: provider.name,
          model: provider.model,
          usage: error.estimate,
          costMicros: costMicros(provider.model, error.estimate),
          estimated: true,
        });
      }
      throw error;
    }
    await recordCall({
      ...callOf(work),
      provider: provider.name,
      model: provider.model,
      usage: reply.usage,
      costMicros: costMicros(provider.model, reply.usage),
    });
    return reply.text;
  }

  /** One provider, with one corrective retry carrying the validation errors. */
  async function extractWith(
    provider: Provider,
    work: Work,
    request: ExtractRequest
  ): Promise<IndexingOutput> {
    const first = await ask(provider, work, request);
    const parsed = parse(first);
    if (parsed.ok) return parsed.output;
    const second = await ask(provider, work, {
      ...request,
      correction: { previous: first.slice(0, 8000), errors: parsed.errors },
    });
    const again = parse(second);
    if (again.ok) return again.output;
    throw new InvalidOutput();
  }

  /**
   * The Memory's vectors, or undefined without an embedder or when it
   * failed: the Memory is still found by keyword, and the hourly sweep
   * tries again in the background. Asks `current` right before the call,
   * so AI opt-out or an edit since loading stops it.
   */
  async function embed(
    work: EmbedSource &
      Claim & {
        revision: number;
        image?: ImageKeys;
      },
    current: () => Promise<boolean>,
    loaded?: Image
  ): Promise<Embedding | undefined> {
    if (!embedder) return undefined;
    const record = (
      usage: { textTokens: number; imageTokens: number },
      estimated?: boolean
    ) =>
      recordCall({
        ...callOf(work),
        provider: embedder.name,
        model: embedder.model,
        usage: {
          inputTokens: usage.textTokens + usage.imageTokens,
          outputTokens: 0,
        },
        costMicros: embedCostMicros(embedder.model, usage),
        ...(estimated && { estimated }),
      });
    let visual = work.image && (await visualOf(work.image, loaded));
    for (;;) {
      const { inputs, parts } = embeddingInputs(work, visual);
      if (!(await current())) throw new Superseded();
      try {
        const { vectors, usage } = await embedder.embed(inputs);
        await record(usage);
        return {
          model: embedder.model,
          dimensions: embedder.dimensions,
          revision: work.revision,
          vectors: parts.map((part, i) => ({
            ...part,
            embedding: vectors[i]!,
          })),
        };
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (error.estimate) {
          const { inputTokens, imageTokens = 0 } = error.estimate;
          await record(
            { textTokens: Math.max(0, inputTokens - imageTokens), imageTokens },
            true
          );
        }
        // An image the model will not read still leaves the text to embed.
        if (error.kind !== "unsupported" || !visual) return undefined;
        visual = undefined;
      }
    }
  }

  /** The image the embedding model reads (PNG or JPEG), if the Memory has one. */
  async function visualOf(image: ImageKeys, loaded?: Image) {
    const reads = (mime: string) =>
      (EMBEDDING.imageTypes as readonly string[]).includes(mime);
    if (loaded && reads(loaded.mime)) return loaded;
    const [key, mime] =
      reads(image.mime) && image.bytes <= INDEXING.maxImageBytes
        ? [image.key, image.mime]
        : [image.thumbnailKey, image.thumbnailMime];
    if (!reads(mime)) return undefined;
    const bytes = await readFile(key);
    return bytes && { bytes, mime };
  }

  /** The image a model sees: the original when every provider reads it, else the thumbnail. */
  async function imageOf(image: ImageKeys) {
    const original =
      image.bytes <= INDEXING.maxImageBytes &&
      (INDEXING.modelImageTypes as readonly string[]).includes(image.mime);
    const [key, mime] = original
      ? [image.key, image.mime]
      : [image.thumbnailKey, image.thumbnailMime];
    const bytes = await readFile(key);
    return bytes && { bytes, mime };
  }

  async function index(job: IndexJob): Promise<IndexOutcome> {
    const loaded =
      job.task === "embed"
        ? embedder &&
          (await store.loadForEmbedding(
            job.memoryId,
            embeddingSpace(embedder.model, embedder.dimensions),
            job.generation
          ))
        : await store.load(job.memoryId, job.run, job.generation);
    if (!loaded) return { result: "skipped" };
    const work = { ...loaded, memoryId: job.memoryId };
    try {
      const outcome =
        "found" in work
          ? await embedLoaded(job, work)
          : await indexLoaded(job, work);
      // The next delivery of this message (or the next embed job, after an
      // edit superseded this one) must be able to take it again.
      if (
        outcome.result === "retry" ||
        outcome.result === "paused" ||
        (job.task === "embed" && outcome.result === "skipped")
      ) {
        await store.release(work);
      }
      return outcome;
    } catch (error) {
      await store.release(work).catch(() => {});
      throw error;
    }
  }

  /** Background work waits for the next UTC day once the daily budget is spent. */
  /** Today's spend has reached the daily budget (the admin's, else the default). */
  const budgetSpent = async () => {
    const [spent, limit] = await Promise.all([
      store.spentTodayMicros(),
      store.dailyBudgetMicros(),
    ]);
    return spent >= limit;
  };
  const overBudget = async (
    job: IndexJob
  ): Promise<IndexOutcome | undefined> =>
    job.priority === "background" && (await budgetSpent())
      ? { result: "paused", delaySeconds: secondsToNextUtcDay(now()) }
      : undefined;

  /** An `embed` job: the vectors again, nothing else. */
  async function embedLoaded(
    job: IndexJob,
    work: EmbedMemory & { memoryId: string }
  ): Promise<IndexOutcome> {
    const paused = await overBudget(job);
    if (paused) return paused;
    let embedding;
    try {
      embedding = await embed(work, () =>
        store.stillEmbeddable(work, work.revision)
      );
    } catch (error) {
      if (error instanceof Superseded) return { result: "skipped" };
      throw error;
    }
    if (!embedding) {
      // After the last attempt the next hourly sweep picks it up again.
      return job.attempt < INDEXING.maxAttempts
        ? { result: "retry", delaySeconds: backoffSeconds(job.attempt) }
        : { result: "skipped" };
    }
    const written = await store.writeVectors(work, embedding);
    return { result: written ? "searchable" : "skipped" };
  }

  async function indexLoaded(
    job: IndexJob,
    loaded: Work
  ): Promise<IndexOutcome> {
    let work = loaded;
    // A link's Source first (not an AI call, so AI opt-out too, but then
    // never through a third-party reader). Kept once; a Source that is down
    // is asked again, and after the last attempt the link stays Reference only.
    if (work.kind === "link" && work.gathered === false && work.sourceUrl) {
      if (gatherer) {
        const { transient, ...found } = await gatherer.gather(work.sourceUrl, {
          reader: !work.aiOptOut,
        });
        if (transient && job.attempt < INDEXING.maxAttempts) {
          return { result: "retry", delaySeconds: backoffSeconds(job.attempt) };
        }
        const saved = await store.saveGathered(work, found);
        if (!saved) return { result: "skipped" };
        work = { ...work, ...saved };
      }
    }
    // AI opt-out: keyword-indexed from its own text, never sent anywhere.
    if (work.aiOptOut) {
      await store.complete(work, null);
      return { result: "searchable" };
    }
    const paused = await overBudget(job);
    if (paused) return paused;

    const finish = async (reason: IndexFailure): Promise<IndexOutcome> =>
      (await store.fail(work, reason))
        ? { result: "failed", reason }
        : { result: "skipped" };

    const image = work.image ? await imageOf(work.image) : undefined;
    if (work.image && !image) return finish("unreadable");
    const request: ExtractRequest = {
      system: SYSTEM,
      user: memoryPart(work),
      ...(image && { image }),
    };

    const seen = new Set<"invalid" | "unsupported" | "unavailable">();
    for (const provider of providers) {
      try {
        const output = await extractWith(provider, work, request);
        // Extraction may have spent the rest of the budget: a background
        // run then finishes without vectors, and the hourly sweep embeds
        // them once the budget allows (fresh Captures always embed).
        const embedding =
          job.priority === "background" && (await budgetSpent())
            ? undefined
            : await embed(
                { ...work, found: output },
                () => store.isCurrent(work),
                image
              );
        const written = await store.complete(
          work,
          { output, model: provider.model },
          embedding
        );
        return { result: written ? "searchable" : "skipped" };
      } catch (error) {
        if (error instanceof Superseded) return { result: "skipped" };
        if (error instanceof InvalidOutput) seen.add("invalid");
        else if (error instanceof ProviderError && error.kind === "unsupported")
          seen.add("unsupported");
        else seen.add("unavailable");
      }
    }
    // Only an outage is worth another attempt; every provider has already
    // had its corrective retry for invalid output.
    if (seen.has("unavailable") || seen.size === 0) {
      return job.attempt < INDEXING.maxAttempts
        ? { result: "retry", delaySeconds: backoffSeconds(job.attempt) }
        : finish("unavailable");
    }
    return finish(seen.has("invalid") ? "invalid_output" : "unreadable");
  }

  return { index };
}

export type Indexer = ReturnType<typeof createIndexer>;
