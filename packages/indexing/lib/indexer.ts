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

/** One queue message's worth of work. `attempt` starts at 1. */
export type IndexJob = {
  memoryId: string;
  priority: Priority;
  attempt: number;
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

export type Extraction = { output: IndexingOutput; model: string };

/**
 * Where Indexing reads and writes. Every write names the `run` it was
 * loaded at and does nothing (returns false) when Indexing has moved on.
 */
export type IndexStore = {
  /** Undefined when the Memory is gone or is not waiting for Indexing. */
  load(memoryId: string): Promise<PendingMemory | undefined>;
  /** Searchable; `extraction` is null for a Memory with AI opt-out. */
  complete(
    memoryId: string,
    run: number,
    extraction: Extraction | null
  ): Promise<boolean>;
  fail(memoryId: string, run: number, reason: IndexFailure): Promise<boolean>;
  spentTodayMicros(): Promise<number>;
  recordCall(call: {
    userId: string;
    memoryId: string;
    provider: ProviderName;
    model: string;
    usage: Usage;
    costMicros: number;
  }): Promise<void>;
};

export type IndexOutcome =
  | { status: "searchable" | "skipped" }
  | { status: "failed"; reason: IndexFailure }
  /** Try the same message again after `delaySeconds` (counts as an attempt). */
  | { status: "retry"; delaySeconds: number }
  /** Over the daily budget: send it again after `delaySeconds` (not an attempt). */
  | { status: "paused"; delaySeconds: number };

class InvalidOutput extends Error {}

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

const secondsToNextUtcDay = (now: Date) =>
  Math.max(
    60,
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
  async function ask(
    provider: Provider,
    memory: PendingMemory,
    memoryId: string,
    request: ExtractRequest
  ) {
    const reply = await provider.extract(request);
    await store.recordCall({
      userId: memory.userId,
      memoryId,
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
    memory: PendingMemory,
    memoryId: string,
    request: ExtractRequest
  ): Promise<IndexingOutput> {
    const first = await ask(provider, memory, memoryId, request);
    const parsed = parse(first);
    if (parsed.ok) return parsed.output;
    const second = await ask(provider, memory, memoryId, {
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
    const { memoryId } = job;
    const memory = await store.load(memoryId);
    if (!memory) return { status: "skipped" };
    // AI opt-out: keyword-indexed from its own text, never sent anywhere.
    if (memory.aiOptOut) {
      await store.complete(memoryId, memory.run, null);
      return { status: "searchable" };
    }
    if (
      job.priority === "background" &&
      (await store.spentTodayMicros()) >= INDEXING.dailyBudgetMicros
    ) {
      return { status: "paused", delaySeconds: secondsToNextUtcDay(now()) };
    }

    const finish = async (reason: IndexFailure): Promise<IndexOutcome> =>
      (await store.fail(memoryId, memory.run, reason))
        ? { status: "failed", reason }
        : { status: "skipped" };

    const image = memory.image ? await imageOf(memory.image) : undefined;
    if (memory.image && !image) return finish("unreadable");
    const request: ExtractRequest = {
      system: SYSTEM,
      user: memoryPart(memory),
      ...(image && { image }),
    };

    const seen = new Set<"invalid" | "unsupported" | "unavailable">();
    for (const provider of providers) {
      try {
        const output = await extractWith(provider, memory, memoryId, request);
        const written = await store.complete(memoryId, memory.run, {
          output,
          model: provider.model,
        });
        return { status: written ? "searchable" : "skipped" };
      } catch (error) {
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
        ? { status: "retry", delaySeconds: backoffSeconds(job.attempt) }
        : finish("unavailable");
    }
    return finish(seen.has("invalid") ? "invalid_output" : "unreadable");
  }

  return { index };
}

export type Indexer = ReturnType<typeof createIndexer>;
