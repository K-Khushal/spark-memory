import { describe, expect, it } from "vitest";
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
