import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEXING, type TranscriptSegment } from "@spark/core";
import { ToolError, type MediaTools } from "@spark/deep-fetch/fetcher";

/**
 * yt-dlp's arguments. It never logs in and never sends cookies (ADR-0010):
 * no `--cookies`, `--cookies-from-browser`, `--username`, `--netrc` or
 * header is ever passed, and `--ignore-config` keeps a config file on the
 * machine from adding one. `--js-runtimes node` is the JavaScript runtime
 * YouTube needs (docs/research/deep-fetch.md). The URL follows `--`, so it
 * can never be read as an option.
 */
const COMMON = [
  "--ignore-config",
  "--no-playlist",
  "--no-warnings",
  "--js-runtimes",
  "node",
  "--socket-timeout",
  "20",
  "--retries",
  "2",
];
export const MAX_AUDIO_BYTES = 14_000_000;

/** Gemini counts audio at 32 tokens a second, plus a little for the prompt. */
export const estimateAudioTokens = (seconds: number) =>
  Math.ceil(seconds * 32) + 200;

export const probeArgs = (url: string) => [
  ...COMMON,
  "--skip-download",
  "--dump-single-json",
  "--",
  url,
];

/** Audio only, mono, 16 kHz, 24 kbps: an hour is about 11 MB. */
export const audioArgs = (url: string, dir: string) => [
  ...COMMON,
  "-f",
  "bestaudio/best",
  "--max-filesize",
  "200M",
  "-x",
  "--audio-format",
  "mp3",
  "--postprocessor-args",
  "ffmpeg:-ac 1 -ar 16000 -b:a 24k",
  "-o",
  join(dir, "audio.%(ext)s"),
  "--",
  url,
];

const run = (command: string, args: string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      { signal, maxBuffer: 32 * 1024 * 1024, timeout: 4 * 60_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });

const PROMPT =
  "Transcribe the speech in this audio. Reply with JSON only: " +
  '{"segments":[{"seconds":number,"text":string}]}, one segment for each ' +
  "sentence or two, `seconds` being when it starts, counted from the start " +
  "of the audio. Write only words that are spoken. If there is no speech, " +
  'reply {"segments":[]}.';

const SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: { seconds: { type: "number" }, text: { type: "string" } },
        required: ["seconds", "text"],
      },
    },
  },
  required: ["segments"],
};

/**
 * Reads a model's transcript reply: segments in order, with sane times and
 * text. A reply that is not that shape is an error; nothing is invented.
 */
export function parseTranscript(
  reply: string,
  durationSeconds: number
): TranscriptSegment[] {
  const value: unknown = JSON.parse(
    reply
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, "")
      .trim()
  );
  const segments = (value as { segments?: unknown })?.segments;
  if (!Array.isArray(segments)) throw new ToolError("error");
  return segments
    .filter(
      (s): s is TranscriptSegment =>
        !!s &&
        typeof s.text === "string" &&
        s.text.trim() !== "" &&
        Number.isFinite(s.seconds)
    )
    .map((s) => ({
      seconds: Math.max(0, Math.min(Math.floor(s.seconds), durationSeconds)),
      text: s.text.replace(/\s+/g, " ").trim().slice(0, 2000),
    }))
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 5000);
}

/**
 * The container's real tools: yt-dlp and ffmpeg for the audio, Gemini for
 * the transcript. Gemini only on the paid tier (ADR-0005): the key's
 * project must have billing on, which `paidTier` states.
 */
export function createMediaTools({
  apiKey,
  paidTier,
  fetch: send = fetch,
}: {
  apiKey?: string;
  paidTier: boolean;
  fetch?: typeof fetch;
}): MediaTools {
  return {
    makeDir: () => mkdtemp(join(tmpdir(), "spark-job-")),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),

    async probe(url, signal) {
      // Before anything is downloaded: without a paid-tier key (ADR-0005)
      // there is no transcript to make, and that is not worth a retry.
      if (!apiKey || !paidTier) throw new ToolError("unavailable");
      const info = JSON.parse(await run("yt-dlp", probeArgs(url), signal)) as {
        duration?: number;
        is_live?: boolean;
      };
      if (info.is_live || !Number.isFinite(info.duration)) {
        throw new ToolError("nothing");
      }
      return { durationSeconds: info.duration! };
    },

    async downloadAudio(url, dir, signal) {
      await run("yt-dlp", audioArgs(url, dir), signal);
      const file = join(dir, "audio.mp3");
      if ((await stat(file)).size > MAX_AUDIO_BYTES) {
        throw new ToolError("too_long");
      }
      return file;
    },

    async transcribe(file, durationSeconds, signal) {
      if (!apiKey || !paidTier) throw new ToolError("unavailable");
      const model = INDEXING.models.gemini;
      // A call that may have been billed but gave no answer (it timed out,
      // the connection dropped, the server failed) is counted at what the
      // audio would have cost, so the budget never misses it.
      const lost = () => [
        {
          model,
          inputTokens: estimateAudioTokens(durationSeconds),
          outputTokens: 0,
          audio: true,
        },
      ];
      let res: Response;
      try {
        res = await send(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: PROMPT },
                    {
                      inlineData: {
                        mimeType: "audio/mpeg",
                        data: (await readFile(file)).toString("base64"),
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                responseJsonSchema: SCHEMA,
                maxOutputTokens: 32_768,
                thinkingConfig: { thinkingLevel: "MINIMAL" },
              },
            }),
          }
        );
      } catch {
        throw new ToolError("error", lost());
      }
      // A 4xx is an answer (nothing was generated or billed); a 5xx may have run.
      if (!res.ok)
        throw new ToolError("error", res.status >= 500 ? lost() : []);
      let reply: {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        };
      };
      try {
        reply = await res.json();
      } catch {
        throw new ToolError("error", lost());
      }
      const meta = reply.usageMetadata;
      const usage = [
        {
          model,
          inputTokens:
            meta?.promptTokenCount ?? estimateAudioTokens(durationSeconds),
          outputTokens:
            (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
          audio: true,
        },
      ];
      const text = (reply.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      try {
        return { transcript: parseTranscript(text, durationSeconds), usage };
      } catch {
        // The model answered and was paid for, whatever it said.
        throw new ToolError("error", usage);
      }
    },
  };
}
