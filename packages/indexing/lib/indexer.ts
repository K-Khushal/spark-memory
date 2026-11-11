import {
  INDEXING,
  IndexingOutput,
  type IndexFailure,
  type ProviderName,
} from "@spark/core";
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
 * One queue message's worth of work. `attempt` starts at 1. `run` is the
 * run it was sent for: a message for an older run does nothing.
 */
export type IndexJob = {
  memoryId: string;
  priority: Priority;
  attempt: number;
  run?: number;
};

/** A Memory waiting for Indexing, as the store loads it. `run` changes whenever Indexing restarts. */
export type PendingMemory = MemoryContent & {
  userId: string;
  run: number;
  aiOptOut: boolean;
  /** Storage keys of an image Memory's files. */
  image?: {
    key: string;
    mime: string;
    bytes: number;
    thumbnailKey: string;
    thumbnailMime: string;
  };
};

/** A loaded Memory and the id it was loaded by. */
type Work = PendingMemory & { memoryId: string };

export type Extraction = { output: IndexingOutput; model: string };

/**
 * Where Indexing reads and writes. Every write names the `run` it was
 * loaded at and does nothing (returns false) when Indexing has moved on.
 */
export type IndexStore = {
  /**
   * Takes the Memory for this delivery (a short lease, so a duplicate
   * delivery skips). Undefined when it is gone, not waiting for Indexing, at
   * another run than `run`, or already taken.
   */
  load(memoryId: string, run?: number): Promise<PendingMemory | undefined>;
  /** Gives the lease back for the next attempt. */
  release(memoryId: string, run: number): Promise<void>;
  /** Still this run, still without AI opt-out: asked before every provider call. */
  isCurrent(memoryId: string, run: number): Promise<boolean>;
  /** Searchable; `extraction` is null for a Memory with AI opt-out. */
  complete(
    memoryId: string,
    run: number,
    extraction: Extraction | null
  ): Promise<boolean>;
  fail(memoryId: string, run: number, reason: IndexFailure): Promise<boolean>;
  spentTodayMicros(): Promise<number>;
  recordCall(call: AiCall): Promise<void>;
};

/** One AI call and what it cost, for the admin page and the budget. */
export type AiCall = {
  userId: string;
  memoryId: string;
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
  readFile,
  now = () => new Date(),
}: {
  store: IndexStore;
  /** In chain order (INDEXING.chain). */
  providers: Provider[];
  /** An object's bytes from storage; undefined when it is not there. */
  readFile: (key: string) => Promise<Uint8Array | undefined>;
  now?: () => Date;
}) {
  /** One provider call for the Memory loaded as `memoryId`, recorded with its cost. */
  async function ask(provider: Provider, work: Work, request: ExtractRequest) {
    // AI opt-out switched on (or an edit, or Retry) since loading: stop here.
    if (!(await store.isCurrent(work.memoryId, work.run)))
      throw new Superseded();
    let reply;
    try {
      reply = await provider.extract(request);
    } catch (error) {
      if (error instanceof ProviderError && error.estimate) {
        await store.recordCall({
          userId: work.userId,
          memoryId: work.memoryId,
          provider: provider.name,
          model: provider.model,
          usage: error.estimate,
          costMicros: costMicros(provider.model, error.estimate),
          estimated: true,
        });
      }
      throw error;
    }
    await store.recordCall({
      userId: work.userId,
      memoryId: work.memoryId,
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

  /** The image a model sees: the original when every provider reads it, else the thumbnail. */
  async function imageOf(image: NonNullable<PendingMemory["image"]>) {
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
    const loaded = await store.load(job.memoryId, job.run);
    if (!loaded) return { result: "skipped" };
    const work: Work = { ...loaded, memoryId: job.memoryId };
    try {
      const outcome = await indexLoaded(job, work);
      // The next delivery of this message must be able to take it again.
      if (outcome.result === "retry" || outcome.result === "paused") {
        await store.release(work.memoryId, work.run);
      }
      return outcome;
    } catch (error) {
      await store.release(work.memoryId, work.run).catch(() => {});
      throw error;
    }
  }

  async function indexLoaded(job: IndexJob, work: Work): Promise<IndexOutcome> {
    // AI opt-out: keyword-indexed from its own text, never sent anywhere.
    if (work.aiOptOut) {
      await store.complete(work.memoryId, work.run, null);
      return { result: "searchable" };
    }
    if (
      job.priority === "background" &&
      (await store.spentTodayMicros()) >= INDEXING.dailyBudgetMicros
    ) {
      return { result: "paused", delaySeconds: secondsToNextUtcDay(now()) };
    }

    const finish = async (reason: IndexFailure): Promise<IndexOutcome> =>
      (await store.fail(work.memoryId, work.run, reason))
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
        const written = await store.complete(work.memoryId, work.run, {
          output,
          model: provider.model,
        });
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
