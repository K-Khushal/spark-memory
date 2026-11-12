import { describe, expect, it, vi } from "vitest";
import { FREE_ALLOWANCE, INDEXING } from "@spark/core";
import {
  createIndexer,
  fakeEmbedder,
  fakePdfReader,
  gemini,
  isScan,
  workersAi,
  markdownPages,
  pagePassages,
  pdfBody,
  ProviderError,
  SCAN_SYSTEM,
  workersAiPdf,
  type Claim,
  type ExtractRequest,
  type IndexStore,
  type PendingMemory,
  type Provider,
} from "../index";

const answer = {
  title: "Lease",
  description: "A flat lease.",
  ocrText: "",
  entities: [],
  tags: ["lease"],
  language: "en",
};

/** A provider that answers every call with `reply`, and keeps the requests. */
function provider(
  name: Provider["name"],
  reply: object | ProviderError,
  readsPages = false
) {
  const requests: ExtractRequest[] = [];
  const p: Provider = {
    name,
    model: INDEXING.models[name],
    readsPages,
    extract: vi.fn(async (request: ExtractRequest) => {
      requests.push(request);
      if (reply instanceof ProviderError) throw reply;
      return {
        text: JSON.stringify(reply),
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    }),
  };
  return Object.assign(p, { requests });
}

const pdfMemory = (over: Partial<PendingMemory> = {}): PendingMemory => ({
  userId: "u1",
  generation: "g1",
  run: 1,
  revision: 1,
  kind: "pdf",
  title: "Lease",
  captureNote: null,
  body: null,
  aiOptOut: false,
  pdf: {
    key: "pdf",
    bytes: 100,
    pages: 2,
    pageImages: [
      { page: 1, key: "page-1", mime: "image/jpeg" },
      { page: 2, key: "page-2", mime: "image/jpeg" },
    ],
  },
  ...over,
});

/** An in-memory store for one PDF Memory. */
function memoryStore(memory: PendingMemory) {
  const store = {
    memory,
    completed: [] as unknown[],
    embeddings: [] as unknown[],
    failed: [] as string[],
    load: async () => store.memory,
    release: async () => {},
    isCurrent: async ({ run }: Claim) =>
      run === store.memory.run && !store.memory.aiOptOut,
    complete: vi.fn(
      async (_: Claim, extraction: unknown, embedding?: unknown) => {
        store.completed.push(extraction);
        store.embeddings.push(embedding);
        return true;
      }
    ),
    fail: async (_: Claim, reason: string) => {
      store.failed.push(reason);
      return true;
    },
    savePdfText: vi.fn(async ({ run }: Claim, text: string) => {
      if (run !== store.memory.run || store.memory.body !== null) return false;
      store.memory = { ...store.memory, body: text };
      return true;
    }),
    saveGathered: async () => undefined,
    loadForEmbedding: async () => undefined,
    stillEmbeddable: async () => false,
    writeVectors: async () => false,
    spentTodayMicros: async () => 0,
    dailyBudgetMicros: async () => INDEXING.dailyBudgetMicros,
    recordCall: async () => {},
  };
  return store satisfies IndexStore;
}

const job = (attempt = 1) => ({
  memoryId: "m1",
  priority: "fresh" as const,
  attempt,
});
const files = async (key: string) => new TextEncoder().encode(key);
const long = (word: string) => `${word} `.repeat(60);

describe("a PDF's text", () => {
  it("is read page by page from toMarkdown's page headings", () => {
    expect(
      markdownPages(
        "# memory.pdf\n\n## Contents\n\n### Page 1\nRent is due.\n\n### Page 2\n\n### Page 3\nKeys returned.\n"
      )
    ).toEqual(["Rent is due.", "", "Keys returned."]);
    expect(markdownPages("No headings at all")).toEqual(["No headings at all"]);
  });

  it("keeps the Indexed pages apart by form feeds, and nothing when there is no text", () => {
    expect(pdfBody(["a\fb", " c ", "d"], 2)).toBe("a b\fc");
    expect(pdfBody(["  ", "\n"], 2)).toBe("");
    expect(pdfBody(["x".repeat(200_000)], 1)).toHaveLength(
      FREE_ALLOWANCE.textMaxChars
    );
  });

  it("is a scan below about 100 characters a page", () => {
    expect(isScan("x".repeat(199), 2)).toBe(true);
    expect(isScan("x".repeat(200), 2)).toBe(false);
    expect(isScan(" \n ".repeat(500), 1)).toBe(true);
  });

  it("asks Workers AI for Markdown without metadata, and gives up on a slow answer", async () => {
    const toMarkdown = vi.fn(async () => [
      { format: "markdown", data: "### Page 1\nHello\n### Page 2\nWorld" },
    ]);
    const read = workersAiPdf({ toMarkdown });
    expect(await read(new Uint8Array([1]))).toEqual(["Hello", "World"]);
    expect(toMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ name: "memory.pdf" }),
      { conversionOptions: { pdf: { metadata: false } } }
    );
    await expect(
      workersAiPdf({
        toMarkdown: async () => ({ format: "error", error: "encrypted" }),
      })(new Uint8Array([1]))
    ).rejects.toThrow();
    await expect(
      workersAiPdf(
        { toMarkdown: () => new Promise(() => {}) },
        5
      )(new Uint8Array([1]))
    ).rejects.toThrow();
  });

  it("is read locally from a simple PDF's text, one content stream a page", async () => {
    const pdf =
      "%PDF-1.4\n4 0 obj << /Length 40 >>\nstream\nBT (Hello \\(there\\)) Tj ET\nendstream\nendobj\n5 0 obj << /Length 30 >>\nstream\nBT (Page two) Tj ET\nendstream\nendobj\n";
    expect(await fakePdfReader()(new TextEncoder().encode(pdf))).toEqual([
      "Hello (there)",
      "Page two",
    ]);
  });

  it("is cut into Passages that never cross a page, each with its page", () => {
    const text = `${"a".repeat(3000)}\f${"b".repeat(100)}`;
    const cut = pagePassages(text, 60, 2);
    expect(
      cut.every((p) => text.slice(p.start, p.end).includes("\f") === false)
    ).toBe(true);
    expect(cut.at(-1)).toEqual({ start: 3001, end: 3101, page: 2 });
    expect(cut[0]!.page).toBe(1);
    // No page breaks in a long PDF's text: no page can be said.
    expect(pagePassages("abc", 60, 5)).toEqual([{ start: 0, end: 3 }]);
    expect(pagePassages("abc", 60, 1)).toEqual([{ start: 0, end: 3, page: 1 }]);
  });
});

describe("Indexing a PDF", () => {
  it("describes a text PDF from its own text, kept once, with a Visual and Passages per page", async () => {
    const store = memoryStore(pdfMemory());
    const gemma = provider("workers-ai", answer);
    const readPdf = vi.fn(async () => [long("rent"), long("keys")]);
    const { index } = createIndexer({
      store,
      providers: [gemma],
      embedder: fakeEmbedder(8),
      readPdf,
      readFile: files,
    });
    expect(await index(job())).toEqual({ result: "searchable" });
    expect(readPdf).toHaveBeenCalledOnce();
    expect(store.memory.body).toBe(
      `${long("rent").trim()}\f${long("keys").trim()}`
    );
    expect(gemma.requests[0]!.user).toContain('<memory kind="pdf">');
    expect(gemma.requests[0]!.user).toContain("rent rent");
    expect(gemma.requests[0]!.pages).toBeUndefined();
    const { vectors } = store.embeddings[0] as {
      vectors: { kind: string; anchor?: { page?: number; field?: string } }[];
    };
    expect(vectors.map((v) => [v.kind, v.anchor?.page])).toEqual([
      ["overview", undefined],
      ["visual", 1],
      ["visual", 2],
      ["passage", 1],
      ["passage", 2],
    ]);
  });

  it("does not read the PDF again once its text is kept", async () => {
    const store = memoryStore(pdfMemory({ body: long("kept") }));
    const readPdf = vi.fn(async () => ["new"]);
    const { index } = createIndexer({
      store,
      providers: [provider("workers-ai", answer)],
      readPdf,
      readFile: files,
    });
    expect(await index(job())).toEqual({ result: "searchable" });
    expect(readPdf).not.toHaveBeenCalled();
  });

  it("sends a scan's page images to a provider that reads them, and keeps each page's text", async () => {
    const store = memoryStore(pdfMemory());
    const gemma = provider("workers-ai", answer);
    const flash = provider(
      "gemini",
      { ...answer, pages: ["Total 12.00", "Thank you"] },
      true
    );
    const { index } = createIndexer({
      store,
      providers: [gemma, flash],
      embedder: fakeEmbedder(8),
      readPdf: async () => ["", " "],
      readFile: files,
    });
    expect(await index(job())).toEqual({ result: "searchable" });
    expect(gemma.requests).toHaveLength(0);
    expect(flash.requests[0]!.system).toBe(SCAN_SYSTEM);
    expect(flash.requests[0]!.pages?.map((p) => p.mime)).toEqual([
      "image/jpeg",
      "image/jpeg",
    ]);
    expect(store.savePdfText).not.toHaveBeenCalled();
    expect(store.completed[0]).toMatchObject({
      output: { ocrText: "Total 12.00\fThank you" },
    });
    const { vectors } = store.embeddings[0] as {
      vectors: { kind: string; anchor?: { page?: number; field?: string } }[];
    };
    expect(
      vectors
        .filter((v) => v.kind === "passage")
        .map((v) => [v.anchor?.field, v.anchor?.page])
    ).toEqual([
      ["ocr", 1],
      ["ocr", 2],
    ]);
  });

  it("tries again when the PDF cannot be read, then reads it as a scan", async () => {
    const readPdf = async () => {
      throw new Error("timed out");
    };
    const first = memoryStore(pdfMemory());
    const flash = provider("gemini", { ...answer, pages: ["a", "b"] }, true);
    const make = (store: ReturnType<typeof memoryStore>) =>
      createIndexer({ store, providers: [flash], readPdf, readFile: files });
    expect(await make(first).index(job(1))).toMatchObject({ result: "retry" });
    expect(flash.requests).toHaveLength(0);
    const last = memoryStore(pdfMemory());
    expect(await make(last).index(job(INDEXING.maxAttempts))).toEqual({
      result: "searchable",
    });
    expect(flash.requests[0]!.pages).toHaveLength(2);
  });

  it("waits for a provider that reads pages, and never sends a scan to Workers AI", async () => {
    const store = memoryStore(pdfMemory());
    const gemma = provider("workers-ai", answer);
    const { index } = createIndexer({
      store,
      providers: [gemma],
      readPdf: async () => [""],
      readFile: files,
    });
    expect(await index(job(1))).toMatchObject({ result: "retry" });
    expect(await index(job(INDEXING.maxAttempts))).toEqual({
      result: "failed",
      reason: "unavailable",
    });
    expect(gemma.requests).toHaveLength(0);
  });

  it("sends nothing anywhere for AI opt-out, toMarkdown included", async () => {
    const store = memoryStore(pdfMemory({ aiOptOut: true }));
    const readPdf = vi.fn(async () => ["text"]);
    const gemma = provider("workers-ai", answer);
    const readFile = vi.fn(files);
    const { index } = createIndexer({
      store,
      providers: [gemma],
      readPdf,
      readFile,
    });
    expect(await index(job())).toEqual({ result: "searchable" });
    expect(readPdf).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(gemma.requests).toHaveLength(0);
    expect(store.completed).toEqual([null]);
  });

  it("stops before reading the PDF when the run has moved on", async () => {
    const store = memoryStore(pdfMemory());
    store.isCurrent = async () => false;
    const readPdf = vi.fn(async () => ["text"]);
    const { index } = createIndexer({
      store,
      providers: [provider("workers-ai", answer)],
      readPdf,
      readFile: files,
    });
    expect(await index(job())).toEqual({ result: "skipped" });
    expect(readPdf).not.toHaveBeenCalled();
  });

  it("fails as unreadable when a page image is missing from storage", async () => {
    const store = memoryStore(pdfMemory());
    const { index } = createIndexer({
      store,
      providers: [provider("gemini", answer, true)],
      readPdf: async () => [""],
      readFile: async (key) => (key === "page-2" ? undefined : files(key)),
    });
    expect(await index(job())).toEqual({
      result: "failed",
      reason: "unreadable",
    });
  });
});

describe("a scan's pages at a provider", () => {
  it("go to Gemini each after its number, with the scan's schema and room for every page", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{}" }] } }],
        })
      );
    });
    const flash = gemini({
      apiKey: "k",
      paidTier: true,
      fetch: fetch as never,
    });
    expect(flash.readsPages).toBe(true);
    const page = { bytes: new Uint8Array([1]), mime: "image/jpeg" };
    await flash.extract({
      system: SCAN_SYSTEM,
      user: "u",
      pages: [page, page],
    });
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string);
    const parts = body.contents[0].parts;
    expect(parts.map((p: { text?: string }) => p.text ?? "image")).toEqual([
      "u",
      "Page 1",
      "image",
      "Page 2",
      "image",
    ]);
    expect(body.generationConfig.responseJsonSchema.required).toContain(
      "pages"
    );
    expect(body.generationConfig.maxOutputTokens).toBe(
      INDEXING.scanMaxOutputTokens
    );
  });

  it("are refused by Workers AI, which reads one image a call", async () => {
    const run = vi.fn();
    const page = { bytes: new Uint8Array([1]), mime: "image/jpeg" };
    await expect(
      workersAi({ run }).extract({ system: "s", user: "u", pages: [page] })
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(run).not.toHaveBeenCalled();
  });
});
