import {
  isVideoUrl,
  normaliseUrl,
  type DeepFetchFailure,
  type TranscriptSegment,
} from "@spark/core";
import { isPrivateAddress, type Resolve } from "@spark/indexing";
import type { EngineUsage } from "./engine";

/**
 * What the container can do, so the handler is testable without yt-dlp,
 * ffmpeg or a model: the real tools are in apps/fetcher. Each throws a
 * `ToolError` to say why it failed.
 */
export type MediaTools = {
  /** A fresh empty directory for one job. */
  makeDir(): Promise<string>;
  /** Removes the directory and everything in it. */
  removeDir(dir: string): Promise<void>;
  /** The video's length in seconds, before anything is downloaded. */
  probe(url: string, signal: AbortSignal): Promise<{ durationSeconds: number }>;
  /** Downloads only the audio, small and mono, into `dir`; returns the file. */
  downloadAudio(url: string, dir: string, signal: AbortSignal): Promise<string>;
  /** A timestamped transcript of the audio, and the model calls it took. */
  transcribe(
    file: string,
    durationSeconds: number,
    signal: AbortSignal
  ): Promise<{ transcript: TranscriptSegment[]; usage: EngineUsage[] }>;
};

/**
 * Why a tool failed. `usage` is any model call that already happened (and
 * may be billed) before it did, so the Worker can still record its cost.
 */
export class ToolError extends Error {
  constructor(
    readonly reason: DeepFetchFailure,
    readonly usage: EngineUsage[] = []
  ) {
    super(reason);
  }
}

const reasonOf = (error: unknown): DeepFetchFailure =>
  error instanceof ToolError ? error.reason : "error";

/** Long enough for an hour of audio to download, transcode and be heard. */
const JOB_TIMEOUT_MS = 5 * 60_000;

const encoder = new TextEncoder();
/** Constant-time comparison of two secrets. */
function sameSecret(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/**
 * The container's HTTP handler (ADR-0010): `POST /fetch` with a bearer
 * token and `{ url, maxMinutes }`, answering `{ ok, transcript, seconds,
 * usage }` or `{ ok: false, reason, seconds }`. It only fetches public
 * video pages (YouTube and Vimeo, by `isVideoUrl`) whose every address is
 * public (private and metadata addresses are refused, as in the Worker's
 * guard), never logs in and sends no cookies. The audio lives in one
 * temporary directory, removed in `finally`: on success, on failure and on
 * timeout. `seconds` is the job's wall time, which Cloud Run bills as CPU
 * time with one vCPU.
 */
export function createFetcher({
  token,
  resolve,
  tools,
  now = () => Date.now(),
}: {
  token: string;
  resolve: Resolve;
  tools: MediaTools;
  now?: () => number;
}) {
  const json = (body: unknown, status = 200) => Response.json(body, { status });

  async function job(url: string, maxMinutes: number) {
    const signal = AbortSignal.timeout(JOB_TIMEOUT_MS);
    const dir = await tools.makeDir();
    try {
      const { durationSeconds } = await tools.probe(url, signal);
      if (!(durationSeconds > 0) || durationSeconds > maxMinutes * 60) {
        throw new ToolError("too_long");
      }
      const file = await tools.downloadAudio(url, dir, signal);
      const { transcript, usage } = await tools.transcribe(
        file,
        durationSeconds,
        signal
      );
      return { transcript, usage };
    } finally {
      // Media is temporary (ADR-0010): gone when the job ends, however it ends.
      await tools.removeDir(dir).catch(() => {
        console.error("fetcher: could not remove a job directory");
      });
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/") return json({ ok: true });
    if (request.method !== "POST" || path !== "/fetch") {
      return json({ ok: false, reason: "error" }, 404);
    }
    const auth = request.headers.get("authorization") ?? "";
    if (!token || !sameSecret(auth, `Bearer ${token}`)) {
      return json({ ok: false, reason: "error" }, 401);
    }
    let body: { url?: unknown; maxMinutes?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: "error", seconds: 0 }, 400);
    }
    const started = now();
    const seconds = () => Math.ceil((now() - started) / 1000);
    const { url, maxMinutes } = body;
    if (
      typeof url !== "string" ||
      typeof maxMinutes !== "number" ||
      !(maxMinutes > 0) ||
      maxMinutes > 600
    ) {
      return json({ ok: false, reason: "error", seconds: 0 }, 400);
    }
    // Only a public video page, in its normalised form, and only at an
    // address on the public internet: yt-dlp follows redirects on its own,
    // so the host it starts at is what we can vouch for.
    const source = normaliseUrl(url);
    if (!source || !isVideoUrl(source)) {
      return json({ ok: false, reason: "not_public", seconds: 0 });
    }
    try {
      const addresses = await resolve(new URL(source).hostname);
      if (!addresses.length || addresses.some(isPrivateAddress)) {
        return json({ ok: false, reason: "not_public", seconds: 0 });
      }
    } catch {
      return json({ ok: false, reason: "error", seconds: seconds() });
    }
    try {
      const { transcript, usage } = await job(source, maxMinutes);
      return json(
        transcript.length
          ? { ok: true, transcript, usage, seconds: seconds() }
          : { ok: false, reason: "nothing", usage, seconds: seconds() }
      );
    } catch (error) {
      const usage = error instanceof ToolError ? error.usage : [];
      return json({
        ok: false,
        reason: reasonOf(error),
        ...(usage.length && { usage }),
        seconds: seconds(),
      });
    }
  };
}
