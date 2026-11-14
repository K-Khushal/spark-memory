import { describe, expect, it, vi } from "vitest";
import { INDEXING } from "@spark/core";
import {
  createIndexer,
  geminiTranscriber,
  ProviderError,
  type Claim,
  type Embedder,
  type Embedding,
  type Extraction,
  type IndexStore,
  type PendingMemory,
  type Provider,
  type Transcriber,
} from "../index";

// A reel's user-provided copy in Indexing (#20, ADR-0010).

const answer = {
  title: "Sourdough in sixty seconds",
  description: "A baker shapes a loaf.",
  ocrText: "",
  entities: [],
  tags: ["bread"],
  language: "en",
};

const provider = (): Provider & { requests: unknown[] } => {
  const requests: unknown[] = [];
  return {
    name: "gemini",
    model: INDEXING.models.gemini,
    requests,
    extract: vi.fn(async (request) => {
      requests.push(request);
      return {
        text: JSON.stringify(answer),
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    }),
  };
};

const reel = (over: Partial<PendingMemory> = {}): PendingMemory => ({
  userId: "u1",
  generation: "g1",
  run: 1,
  revision: 1,
  kind: "video",
  title: null,
  captureNote: null,
  body: null,
  aiOptOut: false,
  gathered: true,
  sourceUrl: "https://www.instagram.com/reel/C1a/",
  transcript: [],
  copy: {
    generation: "copy-1",
    video: { key: "video", mime: "video/mp4", bytes: 4, duration: 30 },
    frames: [
      { key: "f0", mime: "image/jpeg", seconds: 0 },
      { key: "f1", mime: "image/jpeg", seconds: 12 },
    ],
  },
  ...over,
});

function setup(
  memory: PendingMemory,
  {
    transcribe = async () => ({
      segments: [
        { seconds: 1, text: "Knead the dough" },
        { seconds: 9, text: "Fold it twice" },
      ],
      usage: { inputTokens: 9000, outputTokens: 40 },
    }),
    files = ["video", "f0", "f1"],
    embedding = true,
    removing = false,
  }: {
    transcribe?: Transcriber["transcribe"];
    files?: string[];
    embedding?: boolean;
    removing?: boolean;
  } = {}
) {
  const state = {
    memory,
    dropped: [] as string[][],
    generations: [] as string[],
    deleted: [] as string[][],
    completed: [] as { extraction: Extraction | null; embedding?: Embedding }[],
    failed: [] as string[],
    transcripts: [] as unknown[],
    calls: [] as { provider: string }[],
  };
  const store = {
    load: async () => state.memory,
    release: async () => {},
    isCurrent: async ({ run }: Claim) => run === state.memory.run,
    complete: async (
      _: Claim,
      extraction: Extraction | null,
      embedded?: Embedding
    ) => {
      state.completed.push({ extraction, embedding: embedded });
      return true;
    },
    fail: async (_: Claim, reason: string) => {
      state.failed.push(reason);
      return true;
    },
    saveGathered: async () => undefined,
    savePdfText: async () => false,
    loadForEmbedding: async () => undefined,
    stillEmbeddable: async () => false,
    writeVectors: async () => false,
    spentTodayMicros: async () => 0,
    dailyBudgetMicros: async () => INDEXING.dailyBudgetMicros,
    reserve: async () => ({ id: "hold" }),
    releaseHold: async () => {},
    recordCall: async (call: { provider: string }) => {
      state.calls.push(call);
    },
    copy: {
      saveTranscript: async (_: Claim, video: unknown) => {
        state.transcripts.push(video);
        const { transcript } = video as {
          transcript: { seconds: number; text: string }[];
        };
        state.memory = {
          ...state.memory,
          transcript,
          body: transcript.map((s) => s.text).join("\n"),
        };
        return { transcript, body: state.memory.body };
      },
      drop: async (_: Claim, generation: string) => {
        state.generations.push(generation);
        const keys = ["video", "f0", "f1"];
        state.dropped.push(keys);
        return keys;
      },
    },
  } satisfies IndexStore;
  const transcriber: Transcriber = {
    name: "gemini",
    model: INDEXING.models.gemini,
    transcribe: vi.fn(transcribe),
  };
  const embedder: Embedder = {
    name: "gemini",
    model: "m",
    dimensions: 2,
    embed: async (inputs) => ({
      vectors: inputs.map(() => [1, 0]),
      usage: { textTokens: 1, imageTokens: 0 },
    }),
  };
  const gemini = provider();
  const { index } = createIndexer({
    store,
    providers: [gemini],
    transcriber,
    ...(embedding && { embedder }),
    readFile: async (key) =>
      files.includes(key) ? new Uint8Array([1, 2, 3, 4]) : undefined,
    removeFiles: async (keys) => {
      if (removing) throw new Error("storage down");
      state.deleted.push(keys);
    },
  });
  return { state, index, transcriber, gemini };
}

const job = {
  memoryId: "m1",
  generation: "g1",
  priority: "fresh" as const,
  attempt: 1,
};

describe("a reel's copy", () => {
  it("is read once for a transcript and frames, then deleted from storage and the database", async () => {
    const { state, index, gemini } = setup(reel());
    expect(await index(job)).toEqual({ result: "searchable" });
    expect(state.transcripts).toEqual([
      {
        duration: 30,
        transcriptState: "available",
        transcribedBy: "model",
        transcript: [
          { seconds: 1, text: "Knead the dough" },
          { seconds: 9, text: "Fold it twice" },
        ],
      },
    ]);
    // The model describes the reel from its transcript, never from the video.
    expect(JSON.stringify(gemini.requests)).toContain("Knead the dough");
    const vectors = state.completed[0]!.embedding!.vectors;
    expect(
      vectors.filter((v) => v.kind === "visual").map((v) => v.anchor)
    ).toEqual([{ seconds: 0 }, { seconds: 12 }]);
    expect(
      vectors.some((v) => v.kind === "passage" && "seconds" in v.anchor!)
    ).toBe(true);
    expect(state.dropped).toHaveLength(1);
    expect(state.deleted).toEqual([["video", "f0", "f1"]]);
  });

  it("is deleted when Indexing fails for good", async () => {
    const { state, index, gemini } = setup(reel());
    vi.mocked(gemini.extract).mockRejectedValue(new ProviderError("failed"));
    const last = await index({ ...job, attempt: INDEXING.maxAttempts });
    expect(last).toEqual({ result: "failed", reason: "unavailable" });
    expect(state.deleted).toEqual([["video", "f0", "f1"]]);
    expect(state.dropped).toHaveLength(1);
  });

  it("is kept for the next attempt, then deleted on the last", async () => {
    const { state, index, gemini } = setup(reel());
    vi.mocked(gemini.extract).mockRejectedValue(new ProviderError("failed"));
    expect((await index(job)).result).toBe("retry");
    expect(state.deleted).toEqual([]);
    expect(state.dropped).toEqual([]);
  });

  it("is dropped by the generation it read, so a copy attached since survives", async () => {
    const { state, index } = setup(reel());
    await index(job);
    expect(state.generations).toEqual(["copy-1"]);
  });

  it("keeps the answer Indexing reached when storage cannot delete yet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, index } = setup(reel(), { removing: true });
    expect(await index(job)).toEqual({ result: "searchable" });
    // The rows are gone and their objects queued: the sweep finishes the job.
    expect(state.dropped).toHaveLength(1);
    expect(state.deleted).toEqual([]);
  });

  it("is never deleted by an embed job, which does not read it", async () => {
    const { state, index } = setup(reel());
    const store = state.memory;
    expect(store.copy).toBeDefined();
    expect((await index({ ...job, task: "embed" })).result).toBe("skipped");
    expect(state.dropped).toEqual([]);
  });

  it("is deleted, and never read, for AI opt-out", async () => {
    const { state, index, transcriber } = setup(reel({ aiOptOut: true }));
    expect(await index(job)).toEqual({ result: "searchable" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(state.deleted).toEqual([["video", "f0", "f1"]]);
  });

  it("keeps the frames when the video cannot be transcribed, and says so honestly", async () => {
    const { state, index } = setup(reel(), {
      transcribe: async () => {
        throw new ProviderError("unsupported");
      },
    });
    expect(await index(job)).toEqual({ result: "searchable" });
    expect(state.transcripts).toEqual([]);
    expect(
      state.completed[0]!.embedding!.vectors.filter((v) => v.kind === "visual")
    ).toHaveLength(2);
    expect(state.deleted).toHaveLength(1);
  });

  it("retries a transcript the provider could not make, and carries on after the last try", async () => {
    const down = async () => {
      throw new ProviderError("failed");
    };
    const first = setup(reel(), { transcribe: down });
    expect((await first.index(job)).result).toBe("retry");
    expect(first.state.deleted).toEqual([]);
    const last = setup(reel(), { transcribe: down });
    expect(await last.index({ ...job, attempt: INDEXING.maxAttempts })).toEqual(
      {
        result: "searchable",
      }
    );
    expect(last.state.deleted).toHaveLength(1);
  });

  it("does not send a video over the Free allowance's length", async () => {
    const long = reel();
    long.copy!.video.duration = 61 * 60;
    const { state, index, transcriber } = setup(long);
    await index(job);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(1);
  });

  it("indexes from the frames alone when the video is gone from storage", async () => {
    const { state, index, transcriber } = setup(reel(), {
      files: ["f0", "f1"],
    });
    expect(await index(job)).toEqual({ result: "searchable" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(1);
  });

  it("records what the transcript cost", async () => {
    const { state, index } = setup(reel());
    await index(job);
    expect(
      state.calls.filter((c) => c.provider === "gemini").length
    ).toBeGreaterThan(1);
  });
});

describe("the Gemini transcriber", () => {
  const ok = (segments: object[]) =>
    new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ segments }) }] } },
        ],
        usageMetadata: { promptTokenCount: 8000, candidatesTokenCount: 50 },
      })
    );
  const make = (fetch: typeof globalThis.fetch, paidTier = true) =>
    geminiTranscriber({ apiKey: "k", paidTier, fetch });
  const video = { bytes: new Uint8Array([0, 1, 2]), mime: "video/mp4" };

  it("refuses the free tier", () => {
    expect(() => make(vi.fn(), false)).toThrow(/paid tier/);
  });

  it("sends the video inline and keeps only ordered, in-range, non-empty segments", async () => {
    const fetch = vi.fn(async () =>
      ok([
        { seconds: 1, text: " Hello there " },
        { seconds: 0.5, text: "out of order" },
        { seconds: 99, text: "past the end" },
        { seconds: 3, text: "   " },
        { seconds: 5, text: "Bye" },
      ])
    ) as unknown as typeof globalThis.fetch;
    const reply = await make(fetch).transcribe(video, { duration: 30 });
    expect(reply.segments).toEqual([
      { seconds: 1, text: "Hello there" },
      { seconds: 5, text: "Bye" },
    ]);
    expect(reply.usage).toEqual({ inputTokens: 8000, outputTokens: 50 });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init!.body));
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("video/mp4");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "k"
    );
  });

  it("will not send a video past the inline limit", async () => {
    const fetch = vi.fn();
    const huge = {
      bytes: { byteLength: INDEXING.inlineRequestBytes } as Uint8Array,
      mime: "video/mp4",
    };
    await expect(
      make(fetch as unknown as typeof globalThis.fetch).transcribe(huge, {
        duration: 30,
      })
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says a lost call may still be billed", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof globalThis.fetch;
    await expect(
      make(fetch).transcribe(video, { duration: 30 })
    ).rejects.toMatchObject({
      kind: "failed",
      estimate: { inputTokens: expect.any(Number) },
    });
  });
});
