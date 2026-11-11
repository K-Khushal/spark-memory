import { describe, expect, it, vi } from "vitest";
import { EMBEDDING } from "@spark/core";
import {
  createIndexer,
  embeddingInputs,
  fakeEmbedder,
  fakeProvider,
  geminiEmbedding,
  passages,
  ProviderError,
  queryText,
  type EmbedInput,
  type EmbedMemory,
  type Embedder,
  type Embedding,
  type IndexStore,
  type PendingMemory,
} from "../index";

/** An embedder answering with a fixed vector per input, or failing with `error`. */
function stubEmbedder(error?: ProviderError) {
  const seen: EmbedInput[][] = [];
  const embedder: Embedder = {
    name: "gemini",
    model: "gemini-embedding-2",
    dimensions: 3,
    embed: vi.fn(async (inputs: EmbedInput[]) => {
      seen.push(inputs);
      if (error) throw error;
      return {
        vectors: inputs.map((_, i) => [i, 0, 1]),
        usage: { textTokens: 1_000_000, imageTokens: 0 },
      };
    }),
  };
  return Object.assign(embedder, { seen });
}

const pending: PendingMemory = {
  userId: "u1",
  run: 1,
  revision: 4,
  kind: "text",
  title: "Pier",
  captureNote: null,
  body: "Boats rocking at the pier",
  aiOptOut: false,
};

const stale: EmbedMemory = {
  userId: "u1",
  run: 2,
  revision: 7,
  title: null,
  captureNote: null,
  body: "Boats rocking at the pier",
  found: {
    title: "Pier",
    description: "Evening at a harbour",
    ocrText: "",
    tags: ["boats"],
    entities: [],
  },
};

/** A store holding one Memory, for an index job or an embed job. */
function store({
  memory = pending as PendingMemory | undefined,
  embed = stale as EmbedMemory | undefined,
  spent = 0,
  current = (): boolean => true,
} = {}) {
  const s = {
    completed: [] as (Embedding | undefined)[],
    written: [] as Embedding[],
    calls: [] as { costMicros: number; estimated?: boolean }[],
    load: async () => memory,
    release: async () => {},
    isCurrent: async () => current(),
    complete: async (
      _id: string,
      _run: number,
      _found: unknown,
      embedding?: Embedding
    ) => {
      s.completed.push(embedding);
      return true;
    },
    loadForEmbedding: async () => embed,
    stillEmbeddable: async () => current(),
    writeVectors: async (_id: string, _run: number, embedding: Embedding) => {
      s.written.push(embedding);
      return true;
    },
    fail: async () => true,
    spentTodayMicros: async () => spent,
    recordCall: async (call: { costMicros: number; estimated?: boolean }) => {
      s.calls.push(call);
    },
  };
  return s satisfies IndexStore;
}

const indexJob = { memoryId: "m1", priority: "fresh" as const, attempt: 1 };
const embedJob = {
  memoryId: "m1",
  priority: "background" as const,
  attempt: 1,
  task: "embed" as const,
};
const noFiles = async () => undefined;

describe("embedding in the Indexing pipeline", () => {
  it("embeds after Extraction and writes the vectors with the result, at the revision it read", async () => {
    const s = store();
    const embedder = stubEmbedder();
    const { index } = createIndexer({
      store: s,
      providers: [fakeProvider()],
      embedder,
      readFile: noFiles,
    });
    expect(await index(indexJob)).toEqual({ result: "searchable" });
    expect(s.completed[0]).toMatchObject({
      model: "gemini-embedding-2",
      dimensions: 3,
      revision: 4,
      vectors: [
        { kind: "overview", embedding: [0, 0, 1] },
        {
          kind: "passage",
          anchor: { field: "body", start: 0, end: 25 },
          embedding: [1, 0, 1],
        },
      ],
    });
    // 1M text tokens at $0.20/M.
    expect(s.calls.at(-1)).toMatchObject({ costMicros: 200_000 });
  });

  it("keeps a Memory Searchable by keyword when embedding fails, recording what a timed-out call may cost", async () => {
    const s = store();
    const { index } = createIndexer({
      store: s,
      providers: [fakeProvider()],
      embedder: stubEmbedder(
        new ProviderError("failed", { inputTokens: 1000, outputTokens: 0 })
      ),
      readFile: noFiles,
    });
    expect(await index(indexJob)).toEqual({ result: "searchable" });
    expect(s.completed).toEqual([undefined]);
    expect(s.calls.at(-1)).toMatchObject({ estimated: true, costMicros: 200 });
  });

  it("never embeds a Memory with AI opt-out", async () => {
    const embedder = stubEmbedder();
    const { index } = createIndexer({
      store: store({ memory: { ...pending, aiOptOut: true } }),
      providers: [fakeProvider()],
      embedder,
      readFile: noFiles,
    });
    await index(indexJob);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("makes no embedding call once AI opt-out is switched on after Extraction", async () => {
    let checks = 0;
    const s = store({ current: () => ++checks === 1 });
    const embedder = stubEmbedder();
    const { index } = createIndexer({
      store: s,
      providers: [fakeProvider()],
      embedder,
      readFile: noFiles,
    });
    expect(await index(indexJob)).toEqual({ result: "skipped" });
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(s.completed).toEqual([]);
  });

  it("re-embeds a stale Memory in an embed job, with no Extraction", async () => {
    const s = store();
    const extract = vi.fn();
    const { index } = createIndexer({
      store: s,
      providers: [{ name: "fake", model: "fake", extract }],
      embedder: stubEmbedder(),
      readFile: noFiles,
    });
    expect(await index(embedJob)).toEqual({ result: "searchable" });
    expect(extract).not.toHaveBeenCalled();
    expect(s.written[0]).toMatchObject({ revision: 7 });
  });

  it("pauses an embed job past the daily budget", async () => {
    const embedder = stubEmbedder();
    const { index } = createIndexer({
      store: store({ spent: 10_000_000 }),
      providers: [],
      embedder,
      readFile: noFiles,
    });
    expect(await index(embedJob)).toMatchObject({ result: "paused" });
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("drops an embed job whose Memory was edited or opted out before the call", async () => {
    const s = store({ current: () => false });
    const embedder = stubEmbedder();
    const { index } = createIndexer({
      store: s,
      providers: [],
      embedder,
      readFile: noFiles,
    });
    expect(await index(embedJob)).toEqual({ result: "skipped" });
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("retries an embed job while the provider is down, then leaves it to the hourly sweep", async () => {
    const { index } = createIndexer({
      store: store(),
      providers: [],
      embedder: stubEmbedder(new ProviderError("overflow")),
      readFile: noFiles,
    });
    expect(await index(embedJob)).toMatchObject({ result: "retry" });
    expect(await index({ ...embedJob, attempt: 3 })).toEqual({
      result: "skipped",
    });
  });

  it("embeds the text when the model will not read the image", async () => {
    const s = store({
      embed: {
        ...stale,
        image: {
          key: "o",
          mime: "image/png",
          bytes: 10,
          thumbnailKey: "t",
          thumbnailMime: "image/webp",
        },
      },
    });
    const embedder = stubEmbedder();
    embedder.embed = vi.fn(async (inputs: EmbedInput[]) => {
      if (inputs.some((i) => "image" in i)) {
        throw new ProviderError("unsupported");
      }
      return {
        vectors: inputs.map(() => [0, 0, 1]),
        usage: { textTokens: 1, imageTokens: 0 },
      };
    });
    const { index } = createIndexer({
      store: s,
      providers: [],
      embedder,
      readFile: async () => new Uint8Array([1]),
    });
    expect(await index(embedJob)).toEqual({ result: "searchable" });
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    expect(s.written[0]!.vectors.map((v) => v.kind)).toEqual([
      "overview",
      "passage",
    ]);
  });

  it("skips an embed job without an embedder", async () => {
    const { index } = createIndexer({
      store: store(),
      providers: [],
      readFile: noFiles,
    });
    expect(await index(embedJob)).toEqual({ result: "skipped" });
  });
});

describe("what is embedded", () => {
  it("cuts text into overlapping Passages at paragraph or sentence ends, with offsets into it", () => {
    const paragraph = "A sentence about one idea. ".repeat(60);
    const text = `${paragraph}\n\n${paragraph}`;
    const cut = passages(text);
    expect(cut.length).toBeGreaterThan(1);
    for (const p of cut) {
      expect(p.end - p.start).toBeLessThanOrEqual(EMBEDDING.passageChars);
    }
    for (let i = 1; i < cut.length; i++) {
      expect(cut[i]!.start).toBeLessThan(cut[i - 1]!.end); // overlap
      expect(text[cut[i]!.start - 1]).toMatch(/\s/); // at a word
    }
    expect(cut.at(-1)!.end).toBe(text.length);
    expect(passages("x".repeat(100_000)).length).toBe(EMBEDDING.maxPassages);
    expect(passages("   ")).toEqual([]);
  });

  it("makes an Overview, a Visual for an image, and Passages of the text and the text in the image", () => {
    const image = { bytes: new Uint8Array([1]), mime: "image/png" };
    const { inputs, parts } = embeddingInputs(
      { ...stale, found: { ...stale.found, ocrText: "SALE 50%" } },
      image
    );
    expect(parts).toEqual([
      { kind: "overview" },
      { kind: "visual" },
      { kind: "passage", anchor: { field: "body", start: 0, end: 25 } },
      { kind: "passage", anchor: { field: "ocr", start: 0, end: 8 } },
    ]);
    expect(inputs[0]).toEqual({
      text: "title: Pier | text: Evening at a harbour\nboats",
    });
    expect(inputs[1]).toEqual({ image });
  });
});

describe("Gemini Embedding", () => {
  const reply = (vectors: number[][], status = 200) =>
    new Response(
      JSON.stringify({
        embeddings: vectors.map((values) => ({ values })),
        usageMetadata: { promptTokenCount: 12 },
      }),
      { status }
    );

  it("refuses to run without the paid tier", () => {
    expect(() => geminiEmbedding({ apiKey: "k", paidTier: false })).toThrow(
      /paid tier/
    );
  });

  it("asks for one vector per input at the configured size, with the task in the text", async () => {
    const fetch = vi.fn(async () => reply([[1, 0, 0]]));
    const embedder = geminiEmbedding({
      apiKey: "k",
      paidTier: true,
      dimensions: 3,
      fetch,
    });
    const result = await embedder.embed([{ text: queryText("purple") }]);
    expect(result.vectors).toEqual([[1, 0, 0]]);
    expect(result.usage).toEqual({ textTokens: 12, imageTokens: 0 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/gemini-embedding-2:batchEmbedContents$/);
    const body = JSON.parse(init.body as string);
    expect(body.requests[0]).toEqual({
      model: "models/gemini-embedding-2",
      content: { parts: [{ text: "task: search result | query: purple" }] },
      output_dimensionality: 3,
    });
    expect(body.requests[0]).not.toHaveProperty("task_type");
  });

  it("fails on a rate limit, a timeout or a reply of the wrong shape", async () => {
    const embedder = (fetch: typeof globalThis.fetch) =>
      geminiEmbedding({ apiKey: "k", paidTier: true, dimensions: 3, fetch });
    await expect(
      embedder(async () => reply([], 429)).embed([{ text: "a" }])
    ).rejects.toMatchObject({ kind: "overflow" });
    await expect(
      embedder(async () => reply([[1, 0]])).embed([{ text: "a" }])
    ).rejects.toMatchObject({ kind: "failed" });
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error()))
      );
    await expect(
      embedder(hang as typeof fetch).embed([{ text: "abcd" }], {
        timeoutMs: 10,
      })
    ).rejects.toMatchObject({ kind: "failed", estimate: { inputTokens: 1 } });
  });
});

describe("the fake embedder", () => {
  const cosine = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i]!, 0);

  it("puts texts that mean the same thing close and others far apart, the same every time", async () => {
    const { vectors } = await fakeEmbedder().embed([
      { text: queryText("twilight harbor") },
      { text: "title: none | text: Sunset over the dock" },
      { text: "title: none | text: Grocery list: eggs and milk" },
    ]);
    const [query, near, far] = vectors as [number[], number[], number[]];
    expect(cosine(query, near)).toBeGreaterThan(1 - EMBEDDING.directDistance);
    expect(cosine(query, far)).toBeLessThan(1 - EMBEDDING.maxDistance);
    const again = await fakeEmbedder().embed([
      { text: "Sunset over the dock" },
    ]);
    expect(again.vectors[0]).toEqual(
      (await fakeEmbedder().embed([{ text: "Sunset over the dock" }]))
        .vectors[0]
    );
  });
});
