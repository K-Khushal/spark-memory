import type {
  DeepFetchFailure,
  LinkMetadata,
  MemoryKind,
  TranscriptSegment,
} from "@spark/core";

/** What Deep fetch is asked for. Never carries a login, a cookie or a header (ADR-0010). */
export type DeepFetchRequest = {
  url: string;
  kind: Extract<MemoryKind, "link" | "video">;
  /** Longest video to transcribe (the Free allowance). */
  maxMinutes: number;
};

/** One AI call an engine made, for the daily AI budget. */
export type EngineUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** What an engine brought back. */
export type Fetched = {
  /** A page's readable text. */
  text?: string;
  /** What the page says about itself. */
  metadata?: LinkMetadata;
  /** A video's timestamped transcript. */
  transcript?: TranscriptSegment[];
  /** A visible-area screenshot (JPEG) of the page. */
  screenshot?: { bytes: Uint8Array; width: number; height: number };
};

/**
 * Either an engine's answer or why it found none. `seconds` is what the
 * attempt used of the engine's free tier (browser time, CPU time), counted
 * even when it failed; `usage` the AI calls it made.
 */
export type EngineResult =
  | ({ ok: true; seconds: number; usage?: EngineUsage[] } & Fetched)
  | {
      ok: false;
      reason: DeepFetchFailure;
      seconds: number;
      usage?: EngineUsage[];
    };

/** One way of fetching: Browser Rendering, the Cloud Run fetcher, or a fake. Never throws. */
export type Engine = {
  fetch(request: DeepFetchRequest): Promise<EngineResult>;
};

/**
 * Deep fetch (GLOSSARY.md, ADR-0010) behind one call. Pages go to the page
 * engine and video to the media engine; each is swappable, and a kind with
 * no engine configured is simply not `available`.
 */
export type DeepFetch = {
  available(kind: DeepFetchRequest["kind"]): boolean;
  fetch(request: DeepFetchRequest): Promise<EngineResult>;
};

export function createDeepFetch(engines: {
  /** Pages that need JavaScript (Cloudflare Browser Rendering). */
  page?: Engine;
  /** Video and audio (the Cloud Run fetcher). */
  media?: Engine;
}): DeepFetch {
  const engineOf = (kind: DeepFetchRequest["kind"]) =>
    kind === "video" ? engines.media : engines.page;
  return {
    available: (kind) => !!engineOf(kind),
    async fetch(request) {
      const engine = engineOf(request.kind);
      if (!engine) return { ok: false, reason: "error", seconds: 0 };
      try {
        return await engine.fetch(request);
      } catch {
        // An engine must not throw; if it does, that is an error, not a crash.
        return { ok: false, reason: "error", seconds: 0 };
      }
    },
  };
}

/**
 * An engine that answers from a script: the local Worker's stand-in
 * (SPARK_ENV local only) and the tests' fake at the seam. `answer` gets the
 * request and returns the result.
 */
export const fakeEngine = (
  answer: (request: DeepFetchRequest) => EngineResult | Promise<EngineResult>
): Engine => ({ fetch: async (request) => answer(request) });
