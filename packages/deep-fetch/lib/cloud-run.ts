import type { DeepFetchFailure, TranscriptSegment } from "@spark/core";
import {
  MIN_TOKEN_CHARS,
  type Engine,
  type EngineResult,
  type EngineUsage,
} from "./engine";

/**
 * A job takes minutes (download, transcode, one model call); the Worker
 * waits this long for the container, which stops its own work sooner.
 */
const CALL_TIMEOUT_MS = 6 * 60_000;

const FAILURES = new Set([
  "unavailable",
  "not_public",
  "too_long",
  "nothing",
  "error",
]);

const isSegments = (v: unknown): v is TranscriptSegment[] =>
  Array.isArray(v) &&
  v.length <= 20_000 &&
  v.every(
    (s) =>
      !!s &&
      typeof s === "object" &&
      Number.isFinite((s as TranscriptSegment).seconds) &&
      typeof (s as TranscriptSegment).text === "string"
  );

const isUsage = (v: unknown): v is EngineUsage[] =>
  Array.isArray(v) &&
  v.every(
    (u) =>
      !!u &&
      typeof (u as EngineUsage).model === "string" &&
      Number.isFinite((u as EngineUsage).inputTokens) &&
      Number.isFinite((u as EngineUsage).outputTokens) &&
      ((u as EngineUsage).audio === undefined ||
        typeof (u as EngineUsage).audio === "boolean")
  );

/**
 * The Cloud Run fetcher container (apps/fetcher) for video and audio. It
 * downloads the media temporarily, has a model write a timestamped
 * transcript and deletes the file when the job ends; this side only asks
 * and reads the answer, which it validates because it comes over the
 * network. The shared token is the only credential sent, and only to the
 * fetcher, over https: a plain-http address or a token under 32 characters
 * is refused when the engine is made. Cloud Run's free tier is counted in
 * the container's seconds.
 */
export function cloudRunFetcher({
  url,
  token,
  fetch: send = fetch,
}: {
  url: string;
  token: string;
  fetch?: typeof fetch;
}): Engine {
  if (!url.startsWith("https://") || !URL.canParse(url)) {
    throw new Error("the fetcher's URL must be https");
  }
  if (token.length < MIN_TOKEN_CHARS) {
    throw new Error(
      `the fetcher's token must be ${MIN_TOKEN_CHARS}+ characters`
    );
  }
  const endpoint = `${url.replace(/\/+$/, "")}/fetch`;
  return {
    async fetch({ url: source, maxMinutes }): Promise<EngineResult> {
      const started = Date.now();
      let res: Response;
      try {
        res = await send(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ url: source, maxMinutes }),
        });
      } catch {
        // The container may have run until we gave up: that time is spent.
        return {
          ok: false,
          reason: "error",
          seconds: Math.ceil((Date.now() - started) / 1000),
        };
      }
      // Cloud Run answers 429 or 503 when it has no instance to give right
      // now: an ordinary failure, tried again on the usual schedule. Only
      // the budgets the Worker counts itself are a `limit`.
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: "error", seconds: 0 };
      }
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: "error", seconds: 0 };
      }
      const seconds =
        typeof body.seconds === "number" &&
        Number.isFinite(body.seconds) &&
        body.seconds >= 0
          ? Math.ceil(body.seconds)
          : 0;
      const usage = isUsage(body.usage) ? body.usage : undefined;
      if (body.ok === true && isSegments(body.transcript)) {
        return {
          ok: true,
          seconds,
          ...(usage && { usage }),
          transcript: body.transcript,
        };
      }
      const reason =
        typeof body.reason === "string" && FAILURES.has(body.reason)
          ? (body.reason as DeepFetchFailure)
          : "error";
      return { ok: false, reason, seconds, ...(usage && { usage }) };
    },
  };
}
