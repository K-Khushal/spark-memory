import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolError } from "@spark/deep-fetch/fetcher";
import {
  audioArgs,
  createMediaTools,
  parseTranscript,
  probeArgs,
} from "../src/tools";

const FORBIDDEN = [
  "--cookies",
  "--cookies-from-browser",
  "--username",
  "--password",
  "--netrc",
  "--video-password",
  "--add-header",
  "--proxy",
];

describe("yt-dlp arguments", () => {
  const url = "https://www.youtube.com/watch?v=abcdefghijk";
  it("never log in or send cookies, whatever the URL says", () => {
    for (const args of [probeArgs(url), audioArgs(url, "/job")]) {
      for (const flag of FORBIDDEN) expect(args).not.toContain(flag);
      expect(args).toContain("--ignore-config");
      expect(args).toContain("--no-playlist");
    }
  });
  it("puts the URL after `--`, so it can never be read as an option", () => {
    const hostile = "--exec=rm -rf /";
    for (const args of [probeArgs(hostile), audioArgs(hostile, "/job")]) {
      expect(args.at(-1)).toBe(hostile);
      expect(args.at(-2)).toBe("--");
    }
  });
  it("downloads audio only, into the job's own directory", () => {
    const args = audioArgs(url, "/job");
    expect(args).toContain("-x");
    expect(args).toContain("/job/audio.%(ext)s");
    expect(args).toContain("--max-filesize");
  });
});

describe("parseTranscript", () => {
  it("keeps spoken segments in order, with times inside the video", () => {
    const reply = JSON.stringify({
      segments: [
        { seconds: 95.7, text: "  Second   line " },
        { seconds: 3, text: "First line." },
        { seconds: 99999, text: "Past the end." },
        { seconds: 5, text: "   " },
        { seconds: "x", text: "bad" },
      ],
    });
    expect(parseTranscript(reply, 600)).toEqual([
      { seconds: 3, text: "First line." },
      { seconds: 95, text: "Second line" },
      { seconds: 600, text: "Past the end." },
    ]);
  });
  it("accepts a fenced reply, and an empty one means no speech", () => {
    expect(parseTranscript('```json\n{"segments":[]}\n```', 60)).toEqual([]);
  });
  it("refuses a reply that is not a transcript", () => {
    expect(() => parseTranscript('{"text":"hi"}', 60)).toThrow();
    expect(() => parseTranscript("not json", 60)).toThrow();
  });
});

describe("without a paid-tier key", () => {
  it("refuses before downloading anything, as unavailable (ADR-0005)", async () => {
    for (const options of [
      { paidTier: true },
      { apiKey: "key", paidTier: false },
    ]) {
      const tools = createMediaTools(options);
      await expect(
        tools.probe(
          "https://www.youtube.com/watch?v=abcdefghijk",
          AbortSignal.timeout(1000)
        )
      ).rejects.toEqual(new ToolError("unavailable"));
    }
  });
});

describe("transcribe keeps what the model call cost, whatever happened", () => {
  const AUDIO_SECONDS = 600;
  const make = (reply: () => Promise<Response>) =>
    createMediaTools({ apiKey: "key", paidTier: true, fetch: reply });
  const run = async (reply: () => Promise<Response>) => {
    const dir = await mkdtemp(join(tmpdir(), "spark-test-"));
    const file = join(dir, "audio.mp3");
    await writeFile(file, "audio");
    try {
      return await make(reply).transcribe(
        file,
        AUDIO_SECONDS,
        AbortSignal.timeout(2000)
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const failure = async (reply: () => Promise<Response>) => {
    try {
      await run(reply);
    } catch (error) {
      return error as ToolError;
    }
    throw new Error("it did not fail");
  };
  const answer = (text: string, promptTokens = 19_300) =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: {
          promptTokenCount: promptTokens,
          candidatesTokenCount: 40,
        },
      })
    );

  it("returns the transcript with usage marked as audio", async () => {
    const { transcript, usage } = await run(async () =>
      answer('{"segments":[{"seconds":2,"text":"Hello."}]}')
    );
    expect(transcript).toEqual([{ seconds: 2, text: "Hello." }]);
    expect(usage).toEqual([
      {
        model: "gemini-3.5-flash-lite",
        inputTokens: 19_300,
        outputTokens: 40,
        audio: true,
      },
    ]);
  });

  it("counts a reply that is not a transcript: the model answered and was paid for", async () => {
    const error = await failure(async () => answer("not json"));
    expect(error).toBeInstanceOf(ToolError);
    expect(error.reason).toBe("error");
    expect(error.usage).toEqual([
      {
        model: "gemini-3.5-flash-lite",
        inputTokens: 19_300,
        outputTokens: 40,
        audio: true,
      },
    ]);
  });

  it("counts a server error, a dropped connection and an unreadable reply at what the audio costs", async () => {
    const estimate = [
      {
        model: "gemini-3.5-flash-lite",
        inputTokens: AUDIO_SECONDS * 32 + 200,
        outputTokens: 0,
        audio: true,
      },
    ];
    for (const reply of [
      async () => new Response("no", { status: 503 }),
      async () => Promise.reject(new Error("socket hang up")),
      async () => new Response("{ not json", { status: 200 }),
    ]) {
      const error = await failure(reply);
      expect(error.reason).toBe("error");
      expect(error.usage).toEqual(estimate);
    }
  });

  it("counts nothing for an answer that says no: a 4xx generated and billed nothing", async () => {
    for (const status of [400, 403, 429]) {
      const error = await failure(async () => new Response("no", { status }));
      expect(error.usage).toEqual([]);
    }
  });
});
