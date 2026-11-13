import { describe, expect, it } from "vitest";
import {
  cloudflareBrowser,
  cloudRunFetcher,
  createDeepFetch,
  fakeEngine,
} from "../index";

const PAGE = "<html><title>App</title><body></body></html>";
const ARTICLE = "Basil wants six hours of light and warm soil. ".repeat(10);
const RENDERED = `<html><head><title>Basil</title><meta property="og:description" content="Light"></head><body><article>${ARTICLE}</article></body></html>`;
const publicHost = async () => ["93.184.215.14"];

type Call = { url: string; init?: RequestInit };

/** A fetch that serves the Source and Cloudflare's API from a script. */
function world(
  api: (
    path: string,
    body: Record<string, unknown>
  ) => Response | Promise<Response>
) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("api.cloudflare.com")) {
      return api(
        url.split("/browser-rendering/")[1]!,
        JSON.parse(String(init?.body))
      );
    }
    return new Response(PAGE, { headers: { "content-type": "text/html" } });
  };
  return { fetch, calls };
}
const jpeg = (bytes: number) =>
  new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/jpeg" },
  });

describe("createDeepFetch", () => {
  it("sends pages and video to their own engine, and says which it has", async () => {
    const seen: string[] = [];
    const engine = (name: string) =>
      fakeEngine((r) => {
        seen.push(`${name}:${r.url}`);
        return { ok: true, seconds: 1, text: name };
      });
    const both = createDeepFetch({
      page: engine("page"),
      media: engine("media"),
    });
    await both.fetch({ url: "https://a.test/", kind: "link", maxMinutes: 60 });
    await both.fetch({ url: "https://b.test/", kind: "video", maxMinutes: 60 });
    expect(seen).toEqual(["page:https://a.test/", "media:https://b.test/"]);
    const pageOnly = createDeepFetch({ page: engine("page") });
    expect(pageOnly.available("link")).toBe(true);
    expect(pageOnly.available("video")).toBe(false);
    expect(createDeepFetch({}).available("link")).toBe(false);
  });

  it("turns an engine that throws into an error, never a crash", async () => {
    const deep = createDeepFetch({
      page: fakeEngine(() => {
        throw new Error("boom");
      }),
    });
    expect(
      await deep.fetch({ url: "https://a.test/", kind: "link", maxMinutes: 60 })
    ).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("Browser Rendering engine", () => {
  const engine = (fetch: typeof globalThis.fetch, resolve = publicHost) =>
    cloudflareBrowser({ accountId: "acct", apiToken: "tok", fetch, resolve });
  const ask = (e: ReturnType<typeof engine>, url = "https://app.test/post") =>
    e.fetch({ url, kind: "link", maxMinutes: 60 });

  it("reads the rendered page's text and metadata, and keeps a screenshot", async () => {
    const { fetch } = world((path) =>
      path === "content"
        ? Response.json({ success: true, result: RENDERED })
        : jpeg(50_000)
    );
    const result = await ask(engine(fetch));
    expect(result).toMatchObject({
      ok: true,
      metadata: { title: "Basil", description: "Light" },
      screenshot: { width: 1280, height: 800 },
    });
    expect(result.ok && result.text).toContain("six hours of light");
    expect(result.ok && result.screenshot?.bytes.length).toBe(50_000);
  });

  it("keeps the text when the screenshot is missing or too big", async () => {
    for (const shot of [
      () => jpeg(900_000),
      () => new Response("no", { status: 500 }),
    ]) {
      const { fetch } = world((path) =>
        path === "content" ? Response.json({ result: RENDERED }) : shot()
      );
      const result = await ask(engine(fetch));
      expect(result).toMatchObject({ ok: true });
      expect(result.ok && result.screenshot).toBeUndefined();
      expect(result.ok && result.text).toBeTruthy();
    }
  });

  it("does not call text found when the page renders to almost nothing", async () => {
    const { fetch } = world((path) =>
      path === "content"
        ? Response.json({
            result: "<html><title>Sign in</title><body>Log in</body></html>",
          })
        : jpeg(10)
    );
    const result = await ask(engine(fetch));
    expect(result.ok && result.text).toBeUndefined();
  });

  it("never sends the browser to a private address, or past a redirect to one", async () => {
    const direct = world(() => Response.json({ result: RENDERED }));
    for (const host of [
      "http://169.254.169.254/latest",
      "http://localhost/",
      "http://10.0.0.5/x",
    ]) {
      expect(await ask(engine(direct.fetch), host)).toMatchObject({
        ok: false,
        reason: "not_public",
      });
    }
    // The name resolves to a metadata address.
    expect(
      await ask(engine(direct.fetch, async () => ["169.254.169.254"]))
    ).toMatchObject({ ok: false, reason: "not_public" });
    // A public page that redirects to one.
    const redirecting: typeof fetch = async (input) =>
      String(input).includes("cloudflare")
        ? Response.json({ result: RENDERED })
        : new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/" },
          });
    expect(await ask(engine(redirecting))).toMatchObject({
      ok: false,
      reason: "not_public",
    });
    expect(direct.calls.some((c) => c.url.includes("api.cloudflare.com"))).toBe(
      false
    );
  });

  it("sends no cookie, login or header of anyone's: only the account token, to Cloudflare", async () => {
    const { fetch, calls } = world((path) =>
      path === "content" ? Response.json({ result: RENDERED }) : jpeg(10)
    );
    await ask(engine(fetch));
    const api = calls.filter((c) => c.url.includes("api.cloudflare.com"));
    expect(api).toHaveLength(2);
    for (const { init } of api) {
      expect(Object.keys(init!.headers as object).sort()).toEqual([
        "authorization",
        "content-type",
      ]);
      const body = JSON.parse(String(init!.body));
      for (const key of [
        "cookies",
        "authenticate",
        "setExtraHTTPHeaders",
        "userAgent",
      ]) {
        expect(body).not.toHaveProperty(key);
      }
      expect(body.url).toBe("https://app.test/post");
    }
    for (const call of calls.filter(
      (c) => !c.url.includes("api.cloudflare.com")
    )) {
      expect(JSON.stringify(call.init?.headers)).not.toMatch(/cookie|tok/i);
    }
  });

  it("reports its free tier running out as a limit, and errors as errors", async () => {
    const limited = world(() => new Response("slow down", { status: 429 }));
    expect(await ask(engine(limited.fetch))).toMatchObject({
      ok: false,
      reason: "limit",
    });
    const broken = world(() => new Response("no", { status: 500 }));
    expect(await ask(engine(broken.fetch))).toMatchObject({
      ok: false,
      reason: "error",
    });
  });

  it("still fetches a page whose Source answered 403 (a bot wall), once it is known to be public", async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return String(input).includes("cloudflare")
        ? Response.json({ result: RENDERED })
        : new Response("no", {
            status: 403,
            headers: { "content-type": "text/html" },
          });
    };
    expect(await ask(engine(fetch))).toMatchObject({ ok: true });
  });
});

describe("Cloud Run fetcher engine", () => {
  const ENDPOINT = "https://fetcher-abc.a.run.app";
  const TOKEN = "a-strong-shared-token-0123456789-abcdef";
  const engine = (fetch: typeof globalThis.fetch) =>
    cloudRunFetcher({ url: `${ENDPOINT}/`, token: TOKEN, fetch });
  const ask = (e: ReturnType<typeof engine>) =>
    e.fetch({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      kind: "video",
      maxMinutes: 60,
    });

  it("asks the container with the shared token only, and reads the transcript", async () => {
    const seen: Call[] = [];
    const result = await ask(
      engine(async (input, init) => {
        seen.push({ url: String(input), init });
        return Response.json({
          ok: true,
          seconds: 12.2,
          transcript: [{ seconds: 5, text: "Plants need sunlight." }],
          usage: [
            {
              model: "gemini-3.5-flash-lite",
              inputTokens: 100,
              outputTokens: 10,
            },
          ],
        });
      })
    );
    expect(result).toEqual({
      ok: true,
      seconds: 13,
      transcript: [{ seconds: 5, text: "Plants need sunlight." }],
      usage: [
        { model: "gemini-3.5-flash-lite", inputTokens: 100, outputTokens: 10 },
      ],
    });
    expect(seen[0]!.url).toBe(`${ENDPOINT}/fetch`);
    expect(seen[0]!.init!.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(seen[0]!.init!.body))).toEqual({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      maxMinutes: 60,
    });
  });

  it("does not trust an answer that is not the shape it expects", async () => {
    for (const body of [
      { ok: true, transcript: "text" },
      { ok: true, transcript: [{ seconds: "5", text: 1 }] },
      "nonsense",
    ]) {
      expect(await ask(engine(async () => Response.json(body)))).toMatchObject({
        ok: false,
        reason: "error",
      });
    }
    expect(
      await ask(engine(async () => new Response("<html>", { status: 502 })))
    ).toMatchObject({ ok: false, reason: "error" });
  });

  it("passes a reason through, and treats no free instance as an ordinary error", async () => {
    expect(
      await ask(
        engine(async () =>
          Response.json({ ok: false, reason: "too_long", seconds: 2 })
        )
      )
    ).toEqual({ ok: false, reason: "too_long", seconds: 2 });
    expect(
      await ask(
        engine(async () => Response.json({ ok: false, reason: "weird" }))
      )
    ).toMatchObject({ reason: "error" });
    // Cloud Run has no instance to give right now: retried on the usual
    // schedule. `limit` is only for the budgets the Worker counts itself.
    for (const status of [429, 503]) {
      expect(
        await ask(engine(async () => new Response(null, { status })))
      ).toMatchObject({ ok: false, reason: "error" });
    }
    expect(
      await ask(engine(async () => Promise.reject(new Error("down"))))
    ).toMatchObject({ reason: "error" });
  });

  it("keeps the model calls a failed job still made, so their cost is recorded", async () => {
    const usage = [
      {
        model: "gemini-3.5-flash-lite",
        inputTokens: 5000,
        outputTokens: 0,
        audio: true,
      },
    ];
    expect(
      await ask(
        engine(async () =>
          Response.json({ ok: false, reason: "error", seconds: 9, usage })
        )
      )
    ).toEqual({ ok: false, reason: "error", seconds: 9, usage });
  });

  it("refuses a plain-http address and a weak token when it is made", () => {
    const make = (url: string, token: string) =>
      cloudRunFetcher({ url, token, fetch: async () => new Response() });
    expect(() => make("http://fetcher.example.test", TOKEN)).toThrow(/https/);
    expect(() => make("ftp://fetcher.example.test", TOKEN)).toThrow();
    expect(() => make("not a url", TOKEN)).toThrow();
    expect(() => make(ENDPOINT, "short")).toThrow(/32/);
    expect(() => make(ENDPOINT, "x".repeat(31))).toThrow();
    expect(() => make(ENDPOINT, "x".repeat(32))).not.toThrow();
  });
});
