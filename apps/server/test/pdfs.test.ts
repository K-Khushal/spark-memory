import { describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  ctx,
  databaseUrl,
  drain,
  env,
  fakeTurnstile,
  files,
  ORIGIN,
  signedIn,
  postSearch,
} from "./worker";

// PDF Capture through the Worker, against real Postgres: the browser's
// files go to the in-memory bucket through the local presigned URLs, and
// Indexing reads the PDF with the fake reader (INDEXING_PROVIDER=fake).
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Upload = {
  role: string;
  page: number;
  url: string;
  headers: Record<string, string>;
};

/** A two-page PDF whose pages draw text the fake reader can read. */
const pdf = (first: string, second: string) =>
  new TextEncoder().encode(
    `%PDF-1.4\n4 0 obj << >>\nstream\nBT (${first}) Tj ET\nendstream\nendobj\n5 0 obj << >>\nstream\nBT (${second}) Tj ET\nendstream\nendobj\n%%EOF\n`
  );
const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2]);
const webp = new Uint8Array([82, 73, 70, 70, 9, 9]);

const capture = (bytes: Uint8Array, over: object = {}) => ({
  id: crypto.randomUUID(),
  bytes: bytes.byteLength,
  contentHash: "ab".repeat(32),
  title: "Allotment rules",
  pages: 2,
  width: 612,
  height: 792,
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: webp.byteLength },
  pageImages: [1, 2].map(() => ({
    bytes: jpeg.byteLength,
    width: 1024,
    height: 1325,
  })),
  ...over,
});

function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }
) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-length", String(init.body.byteLength));
  return worker.fetch(
    new Request<unknown, IncomingRequestCfProperties>(new URL(url, ORIGIN), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    }),
    env(),
    ctx
  );
}

async function captured(call: Call, bytes: Uint8Array, over: object = {}) {
  const input = capture(bytes, over);
  const res = await call("/api/memories/pdfs", { method: "POST", json: input });
  const body = (await res.json()) as {
    memory: { id: string; kind: string; pages: number };
    uploads: Upload[];
  };
  return { status: res.status, input, ...body };
}

async function uploadAll(uploads: Upload[], pdfBytes: Uint8Array) {
  for (const u of uploads) {
    const body =
      u.role === "original" ? pdfBytes : u.role === "thumbnail" ? webp : jpeg;
    const res = await send(u.url, { method: "PUT", headers: u.headers, body });
    expect(res.status, `${u.role} ${u.page}`).toBe(200);
  }
}

describe.skipIf(!databaseUrl)("PDF Capture", () => {
  it("uploads the PDF and its pages, Indexes its text, and finds the page that matched", async () => {
    const { call } = await signedIn();
    const bytes = pdf("Compost bins go by the shed", "Hoses off after nine");
    const created = await captured(call, bytes);
    expect(created.status).toBe(201);
    expect(created.memory).toMatchObject({ kind: "pdf", pages: 2 });
    expect(created.uploads.map((u) => [u.role, u.page])).toEqual([
      ["original", 0],
      ["thumbnail", 0],
      ["page", 1],
      ["page", 2],
    ]);
    await uploadAll(created.uploads, bytes);
    const stored = await call(`/api/memories/${created.input.id}/stored`, {
      method: "POST",
    });
    expect(stored.status).toBe(200);

    await drain(created.input.id);
    const memory = (await (
      await call(`/api/memories/${created.input.id}`)
    ).json()) as { indexState: string; body: string; pages: number };
    expect(memory).toMatchObject({
      indexState: "searchable",
      body: "Compost bins go by the shed\fHoses off after nine",
      pages: 2,
    });

    // Typed: a keyword in its text. By meaning: the Passage, on its page.
    const words = (await (await postSearch(call, { q: "hoses" })).json()) as {
      results: { id: string; part: object }[];
    };
    expect(words.results[0]).toMatchObject({
      id: created.input.id,
      part: { kind: "field", field: "text" },
    });
    const meaning = (await (
      await postSearch(call, { q: "hoses nine", mode: "full" })
    ).json()) as { results: { id: string; part: object }[] };
    expect(meaning.results[0]?.id).toBe(created.input.id);

    const pages = (await (
      await call(`/api/memories/${created.input.id}/pages`)
    ).json()) as { pages: { page: number; url: string; width: number }[] };
    expect(pages.pages.map((p) => [p.page, p.width])).toEqual([
      [1, 1024],
      [2, 1024],
    ]);
    const image = await send(pages.pages[1]!.url, {});
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    expect(JSON.stringify(pages)).not.toContain('"key"');

    const keys = [...files.objects.keys()].filter((k) =>
      k.includes(created.input.id)
    );
    expect(keys).toHaveLength(4);
    const del = await call(`/api/memories/${created.input.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect(keys.filter((k) => files.objects.has(k))).toEqual([]);
  });

  it("reads a scan from its page images", async () => {
    const { call } = await signedIn();
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    const created = await captured(call, bytes);
    await uploadAll(created.uploads, bytes);
    await call(`/api/memories/${created.input.id}/stored`, { method: "POST" });
    await drain(created.input.id);
    const memory = (await (
      await call(`/api/memories/${created.input.id}`)
    ).json()) as { indexState: string; body: string | null };
    expect(memory).toMatchObject({ indexState: "searchable", body: null });
    const found = (await (await postSearch(call, { q: "scanned" })).json()) as {
      results: { id: string; part: object }[];
    };
    expect(found.results.map((r) => r.id)).toContain(created.input.id);
  });

  it("refuses a PDF over the upload limit, and page images that do not match its pages", async () => {
    const { call } = await signedIn();
    const bytes = pdf("a", "b");
    const big = await call("/api/memories/pdfs", {
      method: "POST",
      json: capture(bytes, { bytes: 26 * 1024 * 1024 }),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: "file_too_large" });
    const wrong = await call("/api/memories/pdfs", {
      method: "POST",
      json: capture(bytes, { pages: 3 }),
    });
    expect(wrong.status).toBe(400);
  });

  it("does not show another person's pages", async () => {
    const ana = await signedIn();
    const ben = await signedIn();
    const bytes = pdf("a", "b");
    const created = await captured(ana.call, bytes);
    expect(
      (await ben.call(`/api/memories/${created.input.id}/pages`)).status
    ).toBe(404);
  });
});
