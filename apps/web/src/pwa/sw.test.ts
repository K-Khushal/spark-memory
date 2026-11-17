import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock("./hold", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  holdShare: held,
}));

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const cached = new Map<string, Map<string, Response>>();
const origin = "https://spark.example";

function fetchEvent(request: Request) {
  const event = { request, respondWith: vi.fn() };
  listeners.get("fetch")!(event);
  return event;
}

beforeEach(async () => {
  listeners.clear();
  cached.clear();
  held.mockClear();
  vi.stubGlobal("__SPARK_SW_VERSION__", "v2");
  vi.stubGlobal("self", {
    location: { origin },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    addEventListener: (type: string, on: Listener) => listeners.set(type, on),
  });
  vi.stubGlobal("caches", {
    keys: async () => [...cached.keys()],
    delete: async (name: string) => cached.delete(name),
    open: async (name: string) => {
      const store = cached.get(name) ?? new Map<string, Response>();
      cached.set(name, store);
      return {
        add: async (req: Request) => {
          store.set(new URL(req.url, origin).pathname, new Response("offline"));
        },
        match: async (path: string) => store.get(path),
      };
    },
  });
  vi.resetModules();
  await import("./sw");
});

afterEach(() => vi.unstubAllGlobals());

describe("service worker", () => {
  it("precaches the offline page and its two fonts", async () => {
    const wait = vi.fn();
    listeners.get("install")!({ waitUntil: wait });
    await wait.mock.calls[0]![0];
    expect([...cached.get("spark-shell-v2-fonts")!.keys()]).toEqual([
      "/offline.html",
      "/fonts/assistant-instrument-sans.woff2",
      "/fonts/assistant-bricolage.woff2",
    ]);
  });

  it("answers font requests from the offline cache", async () => {
    const wait = vi.fn();
    listeners.get("install")!({ waitUntil: wait });
    await wait.mock.calls[0]![0];
    const request = fetchEvent(
      new Request(`${origin}/fonts/assistant-instrument-sans.woff2`)
    );
    expect(await (await request.respondWith.mock.calls[0]![0]).text()).toBe(
      "offline"
    );
  });

  it("drops older shell caches on activate and nothing else", async () => {
    cached.set("spark-shell-v1", new Map());
    cached.set("spark-shell-v2-fonts", new Map());
    cached.set("other", new Map());
    const wait = vi.fn();
    listeners.get("activate")!({ waitUntil: wait });
    await wait.mock.calls[0]![0];
    expect([...cached.keys()].sort()).toEqual([
      "other",
      "spark-shell-v2-fonts",
    ]);
  });

  it("does not answer API calls or asset requests", () => {
    for (const url of ["/api/memories", "/api/auth/get-session", "/a.js"]) {
      const event = fetchEvent(new Request(`${origin}${url}`));
      expect(event.respondWith, url).not.toHaveBeenCalled();
    }
  });

  const share = (
    fields: Record<string, string | File>,
    headers: Record<string, string> = {}
  ) => {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields))
      body.append(name, value);
    return fetchEvent(
      new Request(`${origin}/share`, { method: "POST", body, headers })
    );
  };
  const answer = async (event: { respondWith: ReturnType<typeof vi.fn> }) => {
    const response: Response = await event.respondWith.mock.calls[0]![0];
    return response;
  };
  const sentTo = (response: Response) =>
    new URL(response.headers.get("location")!).pathname +
    new URL(response.headers.get("location")!).search;

  it("holds a share-target POST with its Capture ids and opens the Library", async () => {
    const png = new File([new Uint8Array(8)], "a.png", { type: "image/png" });
    const response = await answer(
      share({ text: "https://example.com", files: png })
    );
    expect(held).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        verified: true,
        text: "https://example.com",
        files: [
          {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            file: expect.any(File),
          },
        ],
      }),
      expect.any(Number)
    );
    expect(response.status).toBe(303);
    expect(sentTo(response)).toBe("/");
  });

  it("holds a post with a hidden Origin, unverified, until the person says so", async () => {
    const response = await answer(share({ text: "maybe" }, { origin: "null" }));
    expect(held).toHaveBeenCalledWith(
      expect.objectContaining({ text: "maybe", verified: false }),
      expect.any(Number)
    );
    expect(sentTo(response)).toBe("/");
  });

  it("stores nothing from a form on another site", async () => {
    const response = await answer(
      share({ text: "buy now" }, { origin: "https://evil.example" })
    );
    expect(held).not.toHaveBeenCalled();
    expect(sentTo(response)).toBe("/share?refused=untrusted");
  });

  it.each([
    ["text past the allowance", { text: "a".repeat(100_001) }, "too_long"],
    [
      "a file over 25 MB",
      {
        files: new File([new Uint8Array(25 * 1024 * 1024 + 1)], "a.png", {
          type: "image/png",
        }),
      },
      "too_large",
    ],
    [
      "a file Spark cannot Capture",
      { files: new File(["x"], "a.mp4", { type: "video/mp4" }) },
      "unsupported",
    ],
    ["nothing", {}, "empty"],
  ])("refuses %s and stores nothing", async (_name, fields, reason) => {
    const response = await answer(share(fields));
    expect(held).not.toHaveBeenCalled();
    expect(sentTo(response)).toBe(`/share?refused=${reason}`);
  });

  it("refuses a body that announces more than a share can hold, unread", async () => {
    const response = await answer(
      share({ text: "x" }, { "content-length": String(10 ** 9) })
    );
    expect(held).not.toHaveBeenCalled();
    expect(sentTo(response)).toBe("/share?refused=too_large");
  });

  it("refuses a body it cannot read", async () => {
    const event = fetchEvent(
      new Request(`${origin}/share`, {
        method: "POST",
        body: "not a form",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      })
    );
    expect(sentTo(await answer(event))).toBe("/share?refused=unreadable");
    expect(held).not.toHaveBeenCalled();
  });

  it("says so when too many shares are already held", async () => {
    held.mockResolvedValueOnce(false);
    const response = await answer(share({ text: "hello" }));
    expect(sentTo(response)).toBe("/share?refused=storage");
  });

  it("says so when the share cannot be stored, never that it was delivered", async () => {
    held.mockRejectedValueOnce(new Error("quota"));
    const response = await answer(share({ text: "hello" }));
    expect(sentTo(response)).toBe("/share?refused=storage");
  });
});
