// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readReel, REEL_READ } from "../lib/sites/reel";

const LIMITS = {
  maxBytes: 100,
  maxFrames: 3,
  frameMaxBytes: 50,
  maxSeconds: 3600,
};
const CODE = "C1a_b2";
const CDN = "https://scontent-sin.cdninstagram.com/v/t50/reel.mp4";

/** What the fake page does: every request, and each frame drawn. */
let requests: { url: string; init?: RequestInit }[];
let drawn: number[];
let revoked: string[];
let duration = 30;

const info = (versions: object[]) =>
  Response.json({ items: [{ video_versions: versions }] });
const stream = (bytes: number) =>
  new Response(new Uint8Array(bytes).fill(7), {
    headers: { "content-type": "video/mp4" },
  });

function page(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const route = routes[url] ?? (() => new Response("", { status: 404 }));
    return route();
  });
}

beforeEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("https://www.instagram.com/reel/C1a_b2/");
  requests = [];
  drawn = [];
  revoked = [];
  duration = 30;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => "blob:https://www.instagram.com/reel",
      revokeObjectURL: (url: string) => revoked.push(url),
    })
  );
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "video") {
      const listeners = new Map<string, () => void>();
      const video = {
        videoWidth: 720,
        videoHeight: 1280,
        get duration() {
          return duration;
        },
        set currentTime(seconds: number) {
          drawn.push(seconds);
          queueMicrotask(() => listeners.get("seeked")?.());
        },
        set src(_: string) {
          queueMicrotask(() => listeners.get("loadedmetadata")?.());
        },
        addEventListener: (name: string, fn: () => void) =>
          listeners.set(name, fn),
        removeEventListener: (name: string) => listeners.delete(name),
        muted: false,
        preload: "",
        remove() {},
      };
      return video as unknown as HTMLElement;
    }
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (done: (b: Blob) => void, type: string, quality: number) =>
          done(new Blob([new Uint8Array(quality > 0.6 ? 80 : 20)], { type })),
      } as unknown as HTMLElement;
    }
    return create(tag);
  }) as typeof document.createElement);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("asks Instagram's own page API with the person's session, then downloads without it", async () => {
  page({
    "/api/v1/media/3043751670/info/": () => info([{ url: CDN, width: 720 }]),
    [CDN]: () => stream(60),
  });
  const read = await readReel(CODE, LIMITS);
  expect(read).toMatchObject({ ok: true, duration: 30 });
  if (!read.ok) return;
  expect(read.video.startsWith("data:video/mp4;base64,")).toBe(true);
  expect(read.bytes).toBe(60);
  expect(requests[0]!.init).toMatchObject({ credentials: "include" });
  expect(requests[0]!.init?.headers).toMatchObject({
    "x-ig-app-id": REEL_READ.appId,
  });
  // The CDN is a signed URL: no cookies go to it.
  expect(requests[1]).toMatchObject({
    url: CDN,
    init: { credentials: "omit" },
  });
});

it("draws a few evenly spaced frames, each small enough to send", async () => {
  page({
    "/api/v1/media/3043751670/info/": () => info([{ url: CDN, width: 720 }]),
    [CDN]: () => stream(10),
  });
  const read = await readReel(CODE, LIMITS);
  if (!read.ok) throw new Error("not read");
  expect(drawn).toEqual([5, 15, 25]);
  expect(read.frames.map((f) => [f.seconds, f.width, f.height])).toEqual([
    [5, 540, 960],
    [15, 540, 960],
    [25, 540, 960],
  ]);
  // The first quality was too big for a frame: a smaller one was kept.
  expect(read.frames.every((f) => f.bytes <= LIMITS.frameMaxBytes)).toBe(true);
  expect(revoked).toEqual(["blob:https://www.instagram.com/reel"]);
});

it("only downloads from Instagram's own media hosts", async () => {
  page({
    "/api/v1/media/3043751670/info/": () =>
      info([{ url: "https://evil.test/reel.mp4", width: 720 }]),
    "https://evil.test/reel.mp4": () => stream(10),
  });
  expect(await readReel(CODE, LIMITS)).toEqual({
    ok: false,
    reason: "no_video",
  });
  expect(requests).toHaveLength(1);
});

it("tries the next version when one is over the size limit, and gives up when all are", async () => {
  const other = "https://scontent-sin.cdninstagram.com/v/t50/small.mp4";
  page({
    "/api/v1/media/3043751670/info/": () =>
      info([
        { url: CDN, width: 720 },
        { url: other, width: 480 },
      ]),
    [CDN]: () => stream(500),
    [other]: () => stream(40),
  });
  const read = await readReel(CODE, LIMITS);
  expect(read).toMatchObject({ ok: true, bytes: 40 });
  page({
    "/api/v1/media/3043751670/info/": () => info([{ url: CDN, width: 720 }]),
    [CDN]: () => stream(500),
  });
  expect(await readReel(CODE, LIMITS)).toEqual({
    ok: false,
    reason: "too_large",
  });
});

it("fails soft: no session, no video, a bad code, a video too long", async () => {
  page({
    "/api/v1/media/3043751670/info/": () => new Response("", { status: 401 }),
  });
  expect(await readReel(CODE, LIMITS)).toEqual({ ok: false, reason: "info" });
  page({
    "/api/v1/media/3043751670/info/": () => Response.json({ items: [] }),
  });
  expect(await readReel(CODE, LIMITS)).toEqual({
    ok: false,
    reason: "no_video",
  });
  expect(await readReel("not a code!", LIMITS)).toEqual({
    ok: false,
    reason: "code",
  });
  page({
    "/api/v1/media/3043751670/info/": () => info([{ url: CDN, width: 720 }]),
    [CDN]: () => stream(10),
  });
  duration = 4000;
  expect(await readReel(CODE, LIMITS)).toEqual({
    ok: false,
    reason: "too_long",
  });
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  expect(await readReel(CODE, LIMITS)).toEqual({ ok: false, reason: "info" });
});

it("does nothing when the tab is no longer on Instagram", async () => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("https://news.test/");
  page({});
  expect(await readReel(CODE, LIMITS)).toEqual({ ok: false, reason: "origin" });
  expect(requests).toEqual([]);
});
