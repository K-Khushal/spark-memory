import { categorise, type CategoryClient } from "./categories";
import {
  type Category,
  EMBEDDING,
  embeddingSpace,
  FREE_ALLOWANCE,
  indexedPages,
  INDEXING,
  IndexingOutput,
  modelCostMicros,
  PdfScanOutput,
  type IndexFailure,
  type ProviderName,
  type TranscriptSegment,
  type VideoMetadata,
} from "@spark/core";
import {
  embedCostMicros,
  embeddingInputs,
  type EmbedSource,
  type Embedder,
  type Embedding,
  type Visual,
} from "./embedder";
import type { Transcriber } from "./gemini-transcribe";
import type { Gathered, Gatherer } from "./link/gather";
import { isScan, pdfBody, type PdfReader } from "./pdf";
import { memoryPart, SCAN_SYSTEM, SYSTEM, type MemoryContent } from "./prompt";
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
  transcript?: TranscriptSegment[] | null;
  userId: string;
  generation: string;
  run: number;
  /** The text's revision, so vectors made from it are dropped once it is edited. */
  revision: number;
  aiOptOut: boolean;
  /** Not locked by the user and not yet categorised at this revision. */
  categoriesStale?: boolean;
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
  /** Storage keys of a PDF Memory's file and its Indexed pages' images. */
  pdf?: PdfKeys;
  /** A reel's user-provided copy (ADR-0010), once stored; Indexing reads it and deletes it. */
  copy?: CopyKeys;
};

/** A reel's video and the frames drawn from it in the person's browser. */
type CopyKeys = {
  /** Which attempt's upload this is: a copy attached later is not the one to delete. */
  generation: string;
  video: { key: string; mime: string; bytes: number; duration: number };
  frames: { key: string; mime: string; seconds: number }[];
};

/** A PDF and its page images in storage; `pages` is the PDF's page count. */
type PdfKeys = {
  key: string;
  bytes: number;
  pages: number;
  pageImages: { page: number; key: string; mime: string }[];
};

type ImageKeys = NonNullable<PendingMemory["image"]>;
type Image = { bytes: Uint8Array; mime: string };

/** A Searchable Memory whose vectors are to be made again. */
export type EmbedMemory = EmbedSource & {
  categoriesStale?: boolean;
  /** Its Overview vector when the vectors are current, so Categories alone are due. */
  overview?: number[];
  userId: string;
  generation: string;
  run: number;
  revision: number;
  image?: ImageKeys;
  pdf?: PdfKeys;
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
  /** Automatic Categories, once per revision, never over a user's edit; false if refused. */
  writeCategories?(
    claim: Claim,
    revision: number,
    categories: Category[]
  ): Promise<boolean>;
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
   * Keeps a PDF's own text (pages apart by form feeds) once, if the Claim
   * is still current. False otherwise.
   */
  savePdfText(claim: Claim, text: string): Promise<boolean>;
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
        | "transcript"
      > & { gathered: boolean })
    | undefined
  >;
  /**
   * For a store that can hold a reel's copy (the one that loads `copy`).
   * The transcript is kept as the reel's own words for the Claim's run, as
   * its video metadata and text (undefined when the run moved on). `drop`
   * deletes the copy's rows whatever the run and returns the storage keys.
   */
  copy?: {
    saveTranscript(
      claim: Claim,
      video: VideoMetadata
    ): Promise<
      | { transcript: TranscriptSegment[] | null; body: string | null }
      | undefined
    >;
    drop(claim: Claim, generation: string): Promise<string[]>;
  };
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

function parse(
  text: string,
  schema: Pick<typeof IndexingOutput, "safeParse"> = IndexingOutput
) {
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
  const parsed = schema.safeParse(value);
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
  jev,
  readPdf,
  readFile,
  transcriber,
  removeFiles,
  now = () => new Date(),
}: {
  store: IndexStore;
  jev?: CategoryClient;
  /** In chain order (INDEXING.chain). */
  providers: Provider[];
  /** Gathers a link's Source; without one, links are found by their URL and note. */
  gatherer?: Gatherer;
  /** Makes the vectors; without one, Memories are found by keyword only. */
  embedder?: Embedder;
  /** Reads a PDF's text; without one, every PDF reads as a scan. */
  readPdf?: PdfReader;
  /** An object's bytes from storage; undefined when it is not there. */
  readFile: (key: string) => Promise<Uint8Array | undefined>;
  /** Writes down what a reel's copy says; without one, a reel is described from its frames alone. */
  transcriber?: Transcriber;
  /** Deletes objects from storage (a reel's copy, right after Indexing); the sweep deletes what this misses. */
  removeFiles?: (keys: string[]) => Promise<void>;
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
    // A scan's reply has one text per page image, or every page after a
    // missing one would be anchored to the wrong page.
    const count = request.pages?.length;
    const schema = count
      ? PdfScanOutput.refine((o) => o.pages.length === count, {
          message: `expected ${count} pages`,
          path: ["pages"],
        })
      : IndexingOutput;
    const first = await ask(provider, work, request);
    const parsed = parse(first, schema);
    if (parsed.ok) return scanned(parsed.output);
    const second = await ask(provider, work, {
      ...request,
      correction: { previous: first.slice(0, 8000), errors: parsed.errors },
    });
    const again = parse(second, schema);
    if (again.ok) return scanned(again.output);
    throw new InvalidOutput();
  }

  /** A scan's text is its pages', apart by form feeds, so each Passage knows its page. */
  const scanned = (output: IndexingOutput | PdfScanOutput): IndexingOutput => {
    if (!("pages" in output)) return output;
    const { pages, ...rest } = output;
    return {
      ...rest,
      ocrText: pages
        .map((p) => p.replace(/\f/g, " "))
        .join("\f")
        .slice(0, FREE_ALLOWANCE.textMaxChars),
    };
  };

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
        pdf?: PdfKeys;
      },
    current: () => Promise<boolean>,
    loaded?: Visual[]
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
    let visuals = loaded ?? (await visualsOf(work));
    for (;;) {
      const { inputs, parts } = embeddingInputs(
        { ...work, pages: work.pdf?.pages ?? null },
        visuals
      );
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
        if (error.kind !== "unsupported" || !visuals.length) return undefined;
        visuals = [];
      }
    }
  }

  const overviewOf = (embedding: Embedding) =>
    embedding.vectors.find((v) => v.kind === "overview")?.embedding;

  const embedderReads = (mime: string) =>
    (EMBEDDING.imageTypes as readonly string[]).includes(mime);

  /** What the embedding model reads for the Memory's Visuals: its image, or each PDF page's. */
  async function visualsOf(work: {
    image?: ImageKeys;
    pdf?: PdfKeys;
  }): Promise<Visual[]> {
    if (work.pdf) return (await pagesOf(work.pdf)) ?? [];
    const image = work.image && (await visualOf(work.image));
    return image ? [{ image }] : [];
  }

  /** A PDF's page images, in order; undefined when one is not in storage. */
  async function pagesOf(pdf: PdfKeys): Promise<Visual[] | undefined> {
    const pages = await Promise.all(
      pdf.pageImages
        .filter((p) => embedderReads(p.mime))
        .map(async ({ page, key, mime }) => {
          const bytes = await readFile(key);
          return bytes && { image: { bytes, mime }, page };
        })
    );
    return pages.every(Boolean) ? (pages as Visual[]) : undefined;
  }

  /** The image the embedding model reads (PNG or JPEG), if the Memory has one. */
  async function visualOf(image: ImageKeys, loaded?: Image) {
    const reads = embedderReads;
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
    // A legacy delivery cannot identify the Memory it originally targeted.
    // Its attempts must not exhaust a new Memory saved with the same id.
    if (job.generation === undefined) job = { ...job, attempt: 1 };
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
      // A reel's copy exists only for this Indexing: gone once it has ended
      // for good, whatever the end (a Failed reel too). A retry keeps it.
      // An embed job never reads it, so it never deletes it.
      if (
        job.task !== "embed" &&
        "copy" in work &&
        work.copy &&
        (outcome.result === "searchable" || outcome.result === "failed")
      ) {
        await dropCopy(work, work.copy.generation);
      }
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

  /**
   * Deletes the copy's rows, then its objects. Never throws: the answer
   * Indexing reached stands, and the sweep deletes any object this misses
   * (the rows' trigger queued it).
   */
  async function dropCopy(claim: Claim, generation: string) {
    try {
      const keys = (await store.copy?.drop(claim, generation)) ?? [];
      if (keys.length) await removeFiles?.(keys);
    } catch {
      console.error("indexing: a reel's copy was not deleted yet");
    }
  }

  /**
   * A reel's copy: its transcript (once, from the video) kept as the
   * reel's own words, and its frames as the Memory's Visuals. A video the
   * model cannot take, or no transcript after the last attempt, leaves the
   * frames and the metadata: the reel is still found.
   */
  async function readCopy(
    job: IndexJob,
    loaded: Work,
    copy: CopyKeys
  ): Promise<IndexOutcome | { work: Work; visuals: Visual[] }> {
    let work = loaded;
    const long =
      copy.video.duration > FREE_ALLOWANCE.videoTranscriptMaxMinutes * 60;
    if (transcriber && store.copy && !long && !work.transcript?.length) {
      const bytes = await readFile(copy.video.key);
      if (bytes) {
        // Asked again right before the call: AI opt-out may have been
        // switched on, or the reel replaced, while the video was read.
        if (!(await store.isCurrent(work))) return { result: "skipped" };
        try {
          const { segments, usage } = await transcriber.transcribe(
            { bytes, mime: copy.video.mime },
            { duration: copy.video.duration }
          );
          await recordCall({
            ...callOf(work),
            provider: transcriber.name,
            model: transcriber.model,
            usage,
            // The input is a video's sound and picture: priced as audio where a model says so.
            costMicros: modelCostMicros(transcriber.model, {
              ...usage,
              audio: true,
            }),
          });
          // Never silently keep a partial transcript and call it complete.
          const chars = segments.reduce((n, s) => n + s.text.length + 1, 0);
          if (segments.length && chars <= FREE_ALLOWANCE.textMaxChars) {
            const saved = await store.copy.saveTranscript(work, {
              duration: copy.video.duration,
              transcript: segments,
              transcriptState: "available",
              transcribedBy: "model",
            });
            if (!saved) return { result: "skipped" };
            work = { ...work, transcript: saved.transcript, body: saved.body };
          }
        } catch (error) {
          if (error instanceof ProviderError && error.estimate) {
            await recordCall({
              ...callOf(work),
              provider: transcriber.name,
              model: transcriber.model,
              usage: error.estimate,
              costMicros: modelCostMicros(transcriber.model, {
                ...error.estimate,
                audio: true,
              }),
              estimated: true,
            });
          }
          const cannot =
            error instanceof ProviderError && error.kind === "unsupported";
          if (!cannot && job.attempt < INDEXING.maxAttempts) {
            return {
              result: "retry",
              delaySeconds: backoffSeconds(job.attempt),
            };
          }
        }
      }
    }
    const frames = await Promise.all(
      copy.frames
        .filter((f) => embedderReads(f.mime))
        .map(async ({ key, mime, seconds }): Promise<Visual | undefined> => {
          const bytes = await readFile(key);
          return bytes && { image: { bytes, mime }, seconds };
        })
    );
    return { work, visuals: frames.filter((f) => f !== undefined) };
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

  /**
   * Categorise (after the embedding) and keep the answer. A failure leaves
   * the Memory's Categories stale: the hourly sweep tries again.
   */
  async function assignCategories(
    work: Claim & { revision: number; categoriesStale?: boolean },
    vector: number[] | undefined,
    text: string,
    current: () => Promise<boolean>
  ) {
    if (
      !work.categoriesStale ||
      !store.writeCategories ||
      !embedder ||
      !vector
    ) {
      return;
    }
    // Categories are a bonus on the embedding already paid for: whatever
    // goes wrong here leaves them stale for the sweep, never fails the run.
    try {
      const categories = await categorise({
        text,
        vector,
        embedder,
        ...(jev && { jev }),
        allow: async () => !(await budgetSpent()) && (await current()),
        record: (call) => recordCall({ ...callOf(work), ...call }),
      });
      if (categories) {
        await store.writeCategories(work, work.revision, categories);
      }
    } catch {
      console.error("indexing: categories not made");
    }
  }

  /** An `embed` job: the vectors again, nothing else. */
  async function embedLoaded(
    job: IndexJob,
    work: EmbedMemory & { memoryId: string }
  ): Promise<IndexOutcome> {
    const paused = await overBudget(job);
    if (paused) return paused;
    const current = () => store.stillEmbeddable(work, work.revision);
    const text = [
      work.title,
      work.body,
      work.captureNote,
      work.found.title,
      work.found.description,
      work.found.ocrText,
    ]
      .filter(Boolean)
      .join("\n");
    if (work.overview) {
      // Only Categories were due; the vectors stay as they are.
      await assignCategories(work, work.overview, text, current);
      await store.release(work);
      return { result: "searchable" };
    }
    let embedding;
    try {
      embedding = await embed(work, current);
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
    await assignCategories(work, overviewOf(embedding), text, current);
    const written = await store.writeVectors(work, embedding);
    return { result: written ? "searchable" : "skipped" };
  }

  async function indexLoaded(
    job: IndexJob,
    loaded: Work
  ): Promise<IndexOutcome> {
    let work = loaded;
    // A link's Source first (not an AI call, so AI opt-out too, but then
    // never through oEmbed or a reader: `isCurrent` is false for it). Kept
    // once; a Source that is down, or whose name could not be looked up,
    // is asked again, and after the last attempt it stays Reference only.
    if (
      (work.kind === "link" || work.kind === "video") &&
      work.gathered === false &&
      work.sourceUrl
    ) {
      if (gatherer) {
        const claim = work;
        const { transient, ...found } = await gatherer.gather(work.sourceUrl, {
          // Asked again right before each third party: the run may have
          // moved on, or AI opt-out been switched on, while the page loaded.
          thirdParty: () => store.isCurrent(claim),
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

    let request: ExtractRequest;
    let chain = providers;
    let visuals: Visual[] | undefined;
    if (work.copy) {
      const read = await readCopy(job, work, work.copy);
      if ("result" in read) return read;
      ({ work, visuals } = read);
    }
    if (work.pdf) {
      const read = await pdfRequest(job, work, work.pdf);
      if ("result" in read) return read;
      if (read.failed) return finish(read.failed);
      ({ request, visuals } = read);
      work = read.work;
      // A scan's pages go only to a provider that reads them (Gemini, ADR-0005).
      if (request.pages) chain = providers.filter((p) => p.readsPages);
    } else {
      const image = work.image ? await imageOf(work.image) : undefined;
      if (work.image && !image) return finish("unreadable");
      request = {
        system: SYSTEM,
        user: memoryPart(work),
        ...(image && { image }),
      };
      if (image) visuals = embedderReads(image.mime) ? [{ image }] : undefined;
    }

    if (work.kind === "video") {
      request.system +=
        "\nFor a video, describe only the supplied metadata and transcript. Never infer speech or unseen frames from a URL; ocrText must be empty.";
      chain = chain.filter((p) => p.name === "gemini" || p.name === "fake");
      if (!chain.length) {
        const written = await store.complete(work, null);
        return { result: written ? "searchable" : "skipped" };
      }
    }
    const seen = new Set<"invalid" | "unsupported" | "unavailable">();
    for (const provider of chain) {
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
                visuals
              );
        if (embedding) {
          await assignCategories(
            work,
            overviewOf(embedding),
            `${memoryPart(work)}\n${output.title}\n${output.description}\n${output.ocrText}`,
            () => store.isCurrent(work)
          );
        }
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

  /**
   * A PDF's Extraction request. Its text first, once (`toMarkdown`, free
   * and not a model, but never for AI opt-out, which never gets here): kept
   * as the Memory's own text. A text PDF is described from that text; a
   * scan (too few characters a page) from its page images, which are then
   * its Visuals too. The PDF unread after the last attempt reads as a scan.
   */
  async function pdfRequest(
    job: IndexJob,
    loaded: Work,
    pdf: PdfKeys
  ): Promise<
    | IndexOutcome
    | { failed: IndexFailure }
    | {
        failed?: undefined;
        work: Work;
        request: ExtractRequest;
        visuals?: Visual[];
      }
  > {
    let work = loaded;
    const indexed = indexedPages(pdf.pages);
    if (work.body === null && readPdf) {
      if (!(await store.isCurrent(work))) return { result: "skipped" };
      const bytes = await readFile(pdf.key);
      if (!bytes) return { failed: "unreadable" };
      // Asked again right before the call: AI opt-out may have been
      // switched on, or the Memory replaced, while the PDF was read.
      if (!(await store.isCurrent(work))) return { result: "skipped" };
      let text = "";
      try {
        text = pdfBody(await readPdf(bytes), { pages: pdf.pages, indexed });
      } catch {
        if (job.attempt < INDEXING.maxAttempts) {
          return { result: "retry", delaySeconds: backoffSeconds(job.attempt) };
        }
      }
      if (text) {
        if (!(await store.savePdfText(work, text)))
          return { result: "skipped" };
        work = { ...work, body: text };
      }
    }
    if (!isScan(work.body ?? "", indexed)) {
      return {
        work,
        request: { system: SYSTEM, user: memoryPart(work) },
      };
    }
    const pages = await pagesOf(pdf);
    if (!pages?.length) return { failed: "unreadable" };
    return {
      work,
      request: {
        system: SCAN_SYSTEM,
        user: memoryPart(work),
        pages: pages.map((p) => p.image),
      },
      visuals: pages,
    };
  }

  return { index };
}

export type Indexer = ReturnType<typeof createIndexer>;
