import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  ctx,
  databaseUrl,
  deepFetchQueue,
  drain,
  env,
  fakeTurnstile,
  files,
  ORIGIN,
  signedIn,
} from "./worker";

// A reel's user-provided copy through the Worker, against real Postgres: the
// extension's video and frames go to the in-memory bucket through presigned
// URLs, Indexing listens with the fake transcriber, and the copy is deleted.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Upload = {
  role: string;
  page: number;
  url: string;
  headers: Record<string, string>;
};
type Memory = {
  id: string;
  kind: string;
  indexState: string;
  preservation: string;
  video: { transcriptState: string; transcript: { text: string }[] } | null;
  deepFetch: string | null;
};

const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2]);
const copy = {
  bytes: mp4.byteLength,
  duration: 30,
  frames: [0, 10, 20].map((seconds) => ({
    seconds,
    bytes: jpeg.byteLength,
    width: 540,
    height: 960,
  })),
};

afterEach(() => vi.restoreAllMocks());

/** The web as Instagram shows a logged-out visitor: its Open Graph tags only. */
function stubWeb() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") {
      return Response.json({
        Answer:
          url.searchParams.get("type") === "A"
            ? [{ type: 1, data: "93.184.215.14" }]
            : [],
      });
    }
    return new Response(
      `<html><head><meta property="og:title" content="Ana on Instagram"><meta property="og:description" content="Sourdough in 60s"></head></html>`,
      { headers: { "content-type": "text/html" } }
    );
  });
}

const reelUrl = () =>
  `https://www.instagram.com/reel/${crypto.randomUUID().slice(0, 8)}/`;

async function saveReel(call: Call, over: object = {}) {
  const id = crypto.randomUUID();
  const res = await call("/api/memories/links", {
    method: "POST",
    json: { id, url: reelUrl(), ...over },
  });
  expect(res.status).toBe(201);
  await drain(id);
  return id;
}

const read = async (call: Call, id: string) =>
  (await (await call(`/api/memories/${id}`)).json()) as Memory;

const put = (u: Upload, body: Uint8Array) =>
  worker.fetch(
    new Request<unknown, IncomingRequestCfProperties>(new URL(u.url, ORIGIN), {
      method: "PUT",
      headers: { ...u.headers, "content-length": String(body.byteLength) },
      body,
    }),
    env(),
    ctx
  );

async function upload(call: Call, id: string) {
  const res = await call(`/api/memories/${id}/copy`, {
    method: "POST",
    json: copy,
  });
  expect(res.status).toBe(201);
  const { uploads } = (await res.json()) as { uploads: Upload[] };
  for (const u of uploads) {
    expect((await put(u, u.role === "video" ? mp4 : jpeg)).status).toBe(200);
  }
  return uploads;
}

const stored = (call: Call, id: string) =>
  call(`/api/memories/${id}/copy/stored`, { method: "POST" });

const objectsOf = (id: string) =>
  [...files.objects.keys()].filter((key) => key.includes(`/${id}/`));

describe.skipIf(!databaseUrl)("a reel's user-provided copy", () => {
  it("is Indexed for its transcript and frames, then deleted; the reel stays Reference only", async () => {
    const { call } = await signedIn();
    stubWeb();
    const id = await saveReel(call);
    expect(await read(call, id)).toMatchObject({
      kind: "video",
      indexState: "searchable",
      video: { transcriptState: "unavailable" },
    });

    await upload(call, id);
    expect(objectsOf(id)).toHaveLength(4);
    expect((await stored(call, id)).status).toBe(200);
    await drain(id);

    const memory = await read(call, id);
    expect(memory).toMatchObject({
      indexState: "searchable",
      preservation: "reference_only",
      video: { transcriptState: "available" },
      // Its own browser gave the copy: no Deep fetch is asked for it (ADR-0010).
      deepFetch: null,
    });
    expect(deepFetchQueue.sent.map((m) => m.body.memoryId)).not.toContain(id);
    expect(memory.video!.transcript[0]!.text).toContain("quillfeather");
    // The video and every frame are gone from storage.
    expect(objectsOf(id)).toEqual([]);
    // Found by what was said in it.
    const found = (await (
      await call("/api/search", { method: "POST", json: { q: "quillfeather" } })
    ).json()) as {
      results: { id: string }[];
    };
    expect(found.results.map((m) => m.id)).toContain(id);
    // Nothing left to upload for: its transcript is kept.
    const again = await call(`/api/memories/${id}/copy`, {
      method: "POST",
      json: copy,
    });
    expect(await again.json()).toEqual({ ok: true, already: true });
  });

  it("is deleted from storage when Indexing fails", async () => {
    const { call } = await signedIn();
    stubWeb();
    const id = await saveReel(call, { captureNote: "fake:fail" });
    await upload(call, id);
    await stored(call, id);
    // The fake provider answers "fake:fail" with output no model could use.
    await drain(id);
    expect((await read(call, id)).indexState).toBe("failed");
    expect(objectsOf(id)).toEqual([]);
  });

  it("is refused for another person's Memory, anything but a reel, and AI opt-out", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    stubWeb();
    const id = await saveReel(call);
    const post = (c: Call, target: string) =>
      c(`/api/memories/${target}/copy`, { method: "POST", json: copy });
    expect((await post(other.call, id)).status).toBe(404);

    const link = crypto.randomUUID();
    await call("/api/memories/links", {
      method: "POST",
      json: { id: link, url: "https://news.test/a" },
    });
    expect((await post(call, link)).status).toBe(404);
    expect((await post(call, "not-an-id")).status).toBe(404);

    const private_ = await saveReel(call);
    await call(`/api/memories/${private_}/ai-opt-out`, {
      method: "PUT",
      json: { aiOptOut: true },
    });
    const refused = await post(call, private_);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ ok: false, error: "ai_opt_out" });
  });

  it("refuses a video over the Free allowance and a copy that was not uploaded", async () => {
    const { call } = await signedIn();
    stubWeb();
    const id = await saveReel(call);
    const big = await call(`/api/memories/${id}/copy`, {
      method: "POST",
      json: { ...copy, bytes: 26 * 1024 * 1024 },
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ ok: false, error: "file_too_large" });

    await call(`/api/memories/${id}/copy`, { method: "POST", json: copy });
    const early = await stored(call, id);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ ok: false, error: "not_uploaded" });
  });
});

describe.skipIf(!databaseUrl)("a copy nothing here could read", () => {
  it("is not wanted without a transcriber or an embedder, so nothing is taken", async () => {
    const { call } = await signedIn();
    stubWeb();
    const id = await saveReel(call);
    // The same Worker, with no provider configured (no paid Gemini key).
    const bare = env({ INDEXING_PROVIDER: undefined });
    const wanted = async (bindings = env()) =>
      (await (await call(`/api/memories/${id}/copy`, {}, bindings)).json()) as {
        wanted: boolean;
      };
    expect(await wanted()).toEqual({ wanted: true });
    expect(await wanted(bare)).toEqual({ wanted: false });
    const posted = await call(
      `/api/memories/${id}/copy`,
      { method: "POST", json: copy },
      bare
    );
    expect(await posted.json()).toEqual({ ok: true, notNeeded: true });
    expect(objectsOf(id)).toEqual([]);
  });

  it("is not wanted for AI opt-out, a reel with its transcript, or anything but a reel", async () => {
    const { call } = await signedIn();
    stubWeb();
    const id = await saveReel(call);
    const wanted = async (target: string) =>
      (
        (await (await call(`/api/memories/${target}/copy`)).json()) as {
          wanted: boolean;
        }
      ).wanted;
    await call(`/api/memories/${id}/ai-opt-out`, {
      method: "PUT",
      json: { aiOptOut: true },
    });
    expect(await wanted(id)).toBe(false);
    const link = crypto.randomUUID();
    await call("/api/memories/links", {
      method: "POST",
      json: { id: link, url: "https://news.test/a" },
    });
    expect(await wanted(link)).toBe(false);
    expect(await wanted("not-an-id")).toBe(false);
    const done = await saveReel(call);
    await upload(call, done);
    await stored(call, done);
    await drain(done);
    expect(await wanted(done)).toBe(false);
  });
});
