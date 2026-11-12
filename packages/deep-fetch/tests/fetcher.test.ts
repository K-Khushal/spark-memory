import { describe, expect, it } from "vitest";
import { createFetcher, ToolError, type MediaTools } from "../fetcher";

const VIDEO = "https://www.youtube.com/watch?v=abcdefghijk";

/** Tools that record what happened to the job's directory. */
function tools(over: Partial<MediaTools> = {}) {
  const log: string[] = [];
  const t: MediaTools = {
    makeDir: async () => {
      log.push("make");
      return "/job";
    },
    removeDir: async (dir) => {
      log.push(`remove ${dir}`);
    },
    probe: async () => ({ durationSeconds: 600 }),
    downloadAudio: async (_url, dir) => {
      log.push("download");
      return `${dir}/audio.mp3`;
    },
    transcribe: async () => ({
      transcript: [{ seconds: 3, text: "Plants need sunlight." }],
      usage: [
        { model: "gemini-3.5-flash-lite", inputTokens: 1000, outputTokens: 50 },
      ],
    }),
    ...over,
  };
  return { t, log };
}

const handler = (t: MediaTools, resolve = async () => ["93.184.215.14"]) =>
  createFetcher({ token: "secret", resolve, tools: t });
const post = (
  h: ReturnType<typeof handler>,
  body: unknown,
  headers: Record<string, string> = { authorization: "Bearer secret" }
) =>
  h(
    new Request("https://fetcher.test/fetch", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
const ask = async (h: ReturnType<typeof handler>, url = VIDEO) =>
  (await post(h, { url, maxMinutes: 60 })).json();

describe("fetcher container", () => {
  it("answers with a transcript and the model calls it took, and removes the media", async () => {
    const { t, log } = tools();
    expect(await ask(handler(t))).toMatchObject({
      ok: true,
      transcript: [{ seconds: 3, text: "Plants need sunlight." }],
      usage: [{ model: "gemini-3.5-flash-lite" }],
    });
    expect(log).toEqual(["make", "download", "remove /job"]);
  });

  it("removes the media when the download, the transcript or the clock fails", async () => {
    const failures: Partial<MediaTools>[] = [
      {
        downloadAudio: async () => {
          throw new Error("yt-dlp exited 1");
        },
      },
      {
        transcribe: async () => {
          throw new ToolError("error");
        },
      },
      { transcribe: async () => ({ transcript: [], usage: [] }) },
      {
        probe: async () => {
          throw new Error("no such video");
        },
      },
      { probe: async () => ({ durationSeconds: 7200 }) },
    ];
    for (const over of failures) {
      const { t, log } = tools(over);
      const answer = await ask(handler(t));
      expect(answer.ok).toBe(false);
      expect(log.at(-1)).toBe("remove /job");
    }
  });

  it("says why: too long, nothing, or an error", async () => {
    expect(
      await ask(
        handler(tools({ probe: async () => ({ durationSeconds: 3601 }) }).t)
      )
    ).toMatchObject({ ok: false, reason: "too_long" });
    expect(
      await ask(
        handler(
          tools({ transcribe: async () => ({ transcript: [], usage: [] }) }).t
        )
      )
    ).toMatchObject({ ok: false, reason: "nothing" });
    expect(
      await ask(
        handler(
          tools({
            downloadAudio: async () => {
              throw new Error("x");
            },
          }).t
        )
      )
    ).toMatchObject({ ok: false, reason: "error" });
  });

  it("still removes the media when removing fails, and answers anyway", async () => {
    const { t } = tools({
      removeDir: async () => {
        throw new Error("disk");
      },
    });
    expect(await ask(handler(t))).toMatchObject({ ok: true });
  });

  it("refuses without the token, with a wrong one, or for a Memory that is not a public video", async () => {
    const { t, log } = tools();
    const h = handler(t);
    expect((await post(h, { url: VIDEO, maxMinutes: 60 }, {})).status).toBe(
      401
    );
    expect(
      (
        await post(
          h,
          { url: VIDEO, maxMinutes: 60 },
          { authorization: "Bearer other" }
        )
      ).status
    ).toBe(401);
    for (const url of [
      "https://example.com/video.mp4",
      "http://169.254.169.254/computeMetadata/v1/",
      "http://localhost:8080/",
      "file:///etc/passwd",
      "https://user:pw@www.youtube.com/watch?v=abcdefghijk",
    ]) {
      expect(await ask(h, url)).toMatchObject({
        ok: false,
        reason: "not_public",
      });
    }
    expect(log).toEqual([]);
  });

  it("refuses a video host that resolves to a private or metadata address", async () => {
    for (const address of [
      "169.254.169.254",
      "10.0.0.1",
      "127.0.0.1",
      "::1",
      "fd00::1",
    ]) {
      const { t, log } = tools();
      expect(await ask(handler(t, async () => [address]))).toMatchObject({
        ok: false,
        reason: "not_public",
      });
      expect(log).toEqual([]);
    }
  });

  it("rejects malformed requests without touching the disk", async () => {
    const { t, log } = tools();
    const h = handler(t);
    expect((await post(h, { url: VIDEO })).status).toBe(400);
    expect((await post(h, { url: 5, maxMinutes: 60 })).status).toBe(400);
    expect((await post(h, { url: VIDEO, maxMinutes: 100000 })).status).toBe(
      400
    );
    expect(log).toEqual([]);
  });
});
