import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => vi.fn(async () => {}));
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
  it("precaches only the offline page", async () => {
    const wait = vi.fn();
    listeners.get("install")!({ waitUntil: wait });
    await wait.mock.calls[0]![0];
    expect([...cached.get("spark-shell-v2")!.keys()]).toEqual([
      "/offline.html",
    ]);
  });

  it("drops older shell caches on activate and nothing else", async () => {
    cached.set("spark-shell-v1", new Map());
    cached.set("spark-shell-v2", new Map());
    cached.set("other", new Map());
    const wait = vi.fn();
    listeners.get("activate")!({ waitUntil: wait });
    await wait.mock.calls[0]![0];
    expect([...cached.keys()].sort()).toEqual(["other", "spark-shell-v2"]);
  });

  it("does not answer API calls or asset requests", () => {
    for (const url of ["/api/memories", "/api/auth/get-session", "/a.js"]) {
      const event = fetchEvent(new Request(`${origin}${url}`));
      expect(event.respondWith, url).not.toHaveBeenCalled();
    }
  });

  it("holds a share-target POST and redirects to the Library", async () => {
    const body = new FormData();
    body.set("text", "https://example.com");
    const event = fetchEvent(
      new Request(`${origin}/share`, { method: "POST", body })
    );
    const response: Response = await event.respondWith.mock.calls[0]![0];
    expect(held).toHaveBeenCalledWith(
      expect.objectContaining({ text: "https://example.com", files: [] })
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });

  it("still redirects when the hold fails", async () => {
    held.mockRejectedValueOnce(new Error("quota"));
    const event = fetchEvent(
      new Request(`${origin}/share`, { method: "POST", body: new FormData() })
    );
    const response: Response = await event.respondWith.mock.calls[0]![0];
    expect(response.status).toBe(303);
  });
});
