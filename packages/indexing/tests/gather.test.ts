import { describe, expect, it } from "vitest";
import {
  createGatherer,
  dohResolver,
  GATHER,
  publicFetch,
  type Resolve,
} from "../index";

type Handler = (request: Request) => Response | Promise<Response>;

/** A fake internet: a handler per URL, every request recorded. */
function web(routes: Record<string, Handler | string>) {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const route = routes[request.url];
    if (route === undefined) return new Response("missing", { status: 404 });
    if (typeof route === "string") {
      return new Response(route, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return route(request);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** Every name resolves to a public address unless listed. */
const resolve =
  (names: Record<string, string[]> = {}): Resolve =>
  async (host) =>
    names[host] ?? ["93.184.215.14"];

const html = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("publicFetch refuses what is not the public web", () => {
  const ok = web({ "https://example.com/": html("<p>hi</p>") });
  const get = (url: string, names?: Record<string, string[]>) =>
    publicFetch(url, { fetch: ok.fetch, resolve: resolve(names) });

  it("fetches a public page", async () => {
    const res = await get("https://example.com/");
    expect(res).toMatchObject({ ok: true, url: "https://example.com/" });
  });

  it.each([
    ["ftp://example.com/", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["https://user:pw@example.com/", "credentials"],
    ["https://example.com:8080/", "port"],
    ["http://localhost/", "private_address"],
    ["http://admin.localhost/", "private_address"],
    ["http://printer.local/", "private_address"],
    ["http://intranet/", "private_address"],
    ["http://127.0.0.1/", "private_address"],
    ["http://2130706433/", "private_address"],
    ["http://0x7f.1/", "private_address"],
    ["http://10.1.2.3/", "private_address"],
    ["http://172.16.0.1/", "private_address"],
    ["http://192.168.1.1/", "private_address"],
    ["http://100.64.0.1/", "private_address"],
    ["http://169.254.169.254/latest/meta-data/", "private_address"],
    ["http://0.0.0.0/", "private_address"],
    ["http://224.0.0.1/", "private_address"],
    ["http://[::1]/", "private_address"],
    ["http://[::]/", "private_address"],
    ["http://[fc00::1]/", "private_address"],
    ["http://[fd12:3456::1]/", "private_address"],
    ["http://[fe80::1]/", "private_address"],
    ["http://[::ffff:127.0.0.1]/", "private_address"],
    ["http://[::ffff:a9fe:a9fe]/", "private_address"],
    ["http://[64:ff9b::a9fe:a9fe]/", "private_address"],
    ["http://[2002:7f00:1::]/", "private_address"],
    ["http://[ff02::1]/", "private_address"],
  ])("%s → %s", async (url, reason) => {
    expect(await get(url)).toEqual({ ok: false, reason });
    expect(ok.requests.every((r) => r.url !== url)).toBe(true);
  });

  it("refuses a name that resolves to a private address", async () => {
    expect(
      await get("https://evil.test/", { "evil.test": ["10.0.0.5"] })
    ).toEqual({ ok: false, reason: "private_address" });
    expect(
      await get("https://evil.test/", {
        "evil.test": ["93.184.215.14", "fd00::1"],
      })
    ).toEqual({ ok: false, reason: "private_address" });
  });

  it("refuses a name that does not resolve", async () => {
    expect(await get("https://nowhere.test/", { "nowhere.test": [] })).toEqual({
      ok: false,
      reason: "unresolved",
    });
  });

  it("checks every redirect again, and refuses one to a private address", async () => {
    const hops = web({
      "https://short.test/a": () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest" },
        }),
    });
    const res = await publicFetch("https://short.test/a", {
      fetch: hops.fetch,
      resolve: resolve(),
    });
    expect(res).toEqual({ ok: false, reason: "private_address" });
    expect(hops.requests.map((r) => r.url)).toEqual(["https://short.test/a"]);
  });

  it("follows a few public redirects, then stops", async () => {
    const loop = web(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `https://hop.test/${i}`,
          () =>
            new Response(null, {
              status: 301,
              headers: { location: `/${i + 1}` },
            }),
        ])
      )
    );
    const res = await publicFetch("https://hop.test/0", {
      fetch: loop.fetch,
      resolve: resolve(),
    });
    expect(res).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(loop.requests).toHaveLength(GATHER.maxRedirects + 1);
  });

  it("refuses types it was not asked for", async () => {
    const pdf = web({
      "https://a.test/f": () =>
        new Response("%PDF", {
          headers: { "content-type": "application/pdf" },
        }),
    });
    expect(
      await publicFetch("https://a.test/f", {
        fetch: pdf.fetch,
        resolve: resolve(),
      })
    ).toEqual({ ok: false, reason: "content_type" });
  });

  it("reads at most maxBytes and says it was cut", async () => {
    const big = web({ "https://a.test/": html("x".repeat(10_000)) });
    const res = await publicFetch("https://a.test/", {
      fetch: big.fetch,
      resolve: resolve(),
      maxBytes: 1000,
    });
    expect(res.ok && res.text.length).toBe(1000);
    expect(res.ok && res.truncated).toBe(true);
  });

  it("gives up after its time limit", async () => {
    const slow = web({
      "https://slow.test/": (request) =>
        new Promise((_, reject) =>
          request.signal.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError"))
          )
        ),
    });
    const res = await publicFetch("https://slow.test/", {
      fetch: slow.fetch,
      resolve: resolve(),
      timeoutMs: 20,
    });
    expect(res).toEqual({ ok: false, reason: "timeout" });
  });

  it("sends no cookies or credentials, and says who it is", async () => {
    await get("https://example.com/");
    const sent = ok.requests.at(-1)!;
    expect(sent.headers.get("cookie")).toBeNull();
    expect(sent.headers.get("authorization")).toBeNull();
    expect(sent.headers.get("user-agent")).toBe(GATHER.userAgent);
    expect(sent.credentials).not.toBe("include");
  });

  it("never sends the caller's headers on to where a redirect points", async () => {
    const hops = web({
      "https://r.test/a": () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.test/b" },
        }),
      "https://elsewhere.test/b": html("<p>hi</p>"),
    });
    await publicFetch("https://r.test/a", {
      fetch: hops.fetch,
      resolve: resolve(),
      headers: { authorization: "Bearer k" },
    });
    expect(hops.requests[0]!.headers.get("authorization")).toBe("Bearer k");
    expect(hops.requests[1]!.headers.get("authorization")).toBeNull();
  });

  it("calls a 5xx unavailable and a 4xx refused", async () => {
    const down = web({
      "https://a.test/5": () => new Response("", { status: 503 }),
      "https://a.test/4": () => new Response("", { status: 403 }),
    });
    const opts = { fetch: down.fetch, resolve: resolve() };
    expect(await publicFetch("https://a.test/5", opts)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await publicFetch("https://a.test/4", opts)).toEqual({
      ok: false,
      reason: "status",
    });
  });
});

describe("dohResolver", () => {
  it("asks for A and AAAA records and returns their addresses", async () => {
    const dns = web({});
    const fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      dns.requests.push(new Request(url));
      const type = url.searchParams.get("type");
      return Response.json({
        Answer:
          type === "A"
            ? [
                { type: 5, data: "alias.test." },
                { type: 1, data: "93.184.215.14" },
              ]
            : [{ type: 28, data: "2606:2800::1" }],
      });
    }) as typeof globalThis.fetch;
    expect(await dohResolver(fetch)("example.com")).toEqual([
      "93.184.215.14",
      "2606:2800::1",
    ]);
  });
});

describe("gather", () => {
  const article = html(
    `<header><nav><a href="/">Home</a> Menu</nav></header>
     <script>var tracking = "do not keep";</script>
     <style>.x{}</style>
     <article>
       <h1>Growing Basil Indoors</h1>
       <p>Basil wants six hours of light &amp; warm soil. ${"Pinch the tops so it bushes out. ".repeat(12)}</p>
       <p>Water from below&#8212;never on the leaves.</p>
       <aside>Related: tomatoes</aside>
     </article>
     <footer>© Garden Weekly</footer>`,
    `<title>Basil | Garden Weekly</title>
     <meta property="og:title" content="Growing Basil Indoors">
     <meta property="og:description" content="A short guide to basil &amp; light.">
     <meta property="og:site_name" content="Garden Weekly">
     <meta property="og:image" content="https://cdn.garden.test/basil.jpg">
     <meta name="author" content="Ana Ruiz">`
  );

  it("keeps Open Graph metadata and the article's readable text", async () => {
    const site = web({ "https://garden.test/basil": article });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather("https://garden.test/basil");
    expect(found.metadata).toMatchObject({
      title: "Growing Basil Indoors",
      description: "A short guide to basil & light.",
      siteName: "Garden Weekly",
      author: "Ana Ruiz",
      imageUrl: "https://cdn.garden.test/basil.jpg",
    });
    expect(found.text).toContain("Basil wants six hours of light & warm soil.");
    expect(found.text).toContain("Water from below—never on the leaves.");
    expect(found.text).not.toMatch(/tracking|Menu|tomatoes|©/);
    expect(found.contentHash).toMatch(/^[\da-f]{64}$/);
    expect(found.transient).toBe(false);
  });

  it("reads JSON-LD when the page has no Open Graph tags", async () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "NewsArticle",
          headline: "Rain Returns",
          description: "Storms end the drought.",
          author: [{ "@type": "Person", name: "Kai Lee" }],
          datePublished: "2026-10-01T08:00:00Z",
          articleBody: "The rain came back on Tuesday. ".repeat(20),
        },
      ],
    });
    const site = web({
      "https://news.test/rain": html(
        "<div>App shell</div>",
        `<script type="application/ld+json">${ld}</script>`
      ),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather("https://news.test/rain");
    expect(found.metadata).toMatchObject({
      title: "Rain Returns",
      description: "Storms end the drought.",
      author: "Kai Lee",
      publishedAt: "2026-10-01T08:00:00Z",
    });
    expect(found.text).toContain("The rain came back on Tuesday.");
  });

  it("keeps no text when the page has too little to be worth preserving", async () => {
    const site = web({
      "https://thin.test/": html(
        "<p>Sign in to continue</p>",
        "<title>Thin</title>"
      ),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather("https://thin.test/");
    expect(found).toMatchObject({ text: null, metadata: { title: "Thin" } });
    expect(found.contentHash).toBeUndefined();
  });

  it("asks a known oEmbed provider, through the same guard", async () => {
    const page = "https://www.youtube.com/watch?v=abc";
    const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`;
    const site = web({
      [page]: html(""),
      [oembed]: () =>
        Response.json({
          title: "Knife Skills 101",
          author_name: "Chef Mo",
          provider_name: "YouTube",
          thumbnail_url: "https://i.ytimg.test/abc.jpg",
        }),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather(page);
    expect(found.metadata).toMatchObject({
      title: "Knife Skills 101",
      author: "Chef Mo",
      siteName: "YouTube",
      imageUrl: "https://i.ytimg.test/abc.jpg",
    });
  });

  it("follows a discovered oEmbed link only to the public web", async () => {
    const site = web({
      "https://blog.test/post": html(
        "",
        `<link rel="alternate" type="application/json+oembed" href="http://169.254.169.254/oembed">`
      ),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    await gather("https://blog.test/post");
    expect(site.requests.map((r) => r.url)).toEqual(["https://blog.test/post"]);
  });

  it("uses a post's text from oEmbed as its description", async () => {
    const page = "https://x.com/someone/status/1";
    const oembed = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(page)}`;
    const site = web({
      [oembed]: () =>
        Response.json({
          author_name: "Someone",
          provider_name: "Twitter",
          html: '<blockquote class="twitter-tweet"><p lang="en">Ship small &amp; often.</p>&mdash; Someone</blockquote>',
        }),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather(page);
    expect(found.metadata).toMatchObject({
      author: "Someone",
      description: expect.stringContaining("Ship small & often."),
    });
  });

  it("keeps Jina Reader off unless it is configured", async () => {
    const site = web({ "https://spa.test/": html("<div id=root></div>") });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    await gather("https://spa.test/");
    expect(site.requests.some((r) => r.url.includes("jina"))).toBe(false);
  });

  it("asks Jina Reader for a thin page when configured and allowed", async () => {
    const reader = `${GATHER.readerUrl}https://spa.test/`;
    const site = web({
      "https://spa.test/": html("<div id=root></div>"),
      [reader]: (request) => {
        expect(request.headers.get("authorization")).toBe("Bearer k");
        return Response.json({
          data: {
            title: "Rendered",
            content: "Text only a browser could see. ".repeat(20),
          },
        });
      },
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
      reader: { apiKey: "k" },
    });
    const found = await gather("https://spa.test/");
    expect(found.text).toContain("Text only a browser could see.");
    expect(found.metadata.title).toBe("Rendered");

    // AI opt-out: nothing goes to a third party.
    site.requests.length = 0;
    await gather("https://spa.test/", { reader: false });
    expect(site.requests.map((r) => r.url)).toEqual(["https://spa.test/"]);
  });

  it("never asks a reader or oEmbed about a link that is not on the public web", async () => {
    const site = web({});
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve({ "wiki.corp.test": ["10.0.0.9"] }),
      reader: {},
    });
    await gather("https://wiki.corp.test/secret");
    await gather("http://169.254.169.254/latest");
    expect(site.requests).toEqual([]);
  });

  it("keeps reading past a tag with an unterminated quote", async () => {
    const ok = web({
      "https://q.test/": html(
        `<p><a title="oops>broken</a></p><p>${"Text after a broken tag. ".repeat(20)}</p>`
      ),
    });
    const again = createGatherer({ fetch: ok.fetch, resolve: resolve() });
    expect((await again.gather("https://q.test/")).text).toContain(
      "Text after a broken tag."
    );
  });

  it("cuts a page title to what a person can keep as a title", async () => {
    const site = web({
      "https://long.test/": html("", `<title>${"T".repeat(5000)}</title>`),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    expect((await gather("https://long.test/")).metadata.title).toHaveLength(
      300
    );
  });

  it("says a failure may pass when the Source is down", async () => {
    const site = web({
      "https://down.test/": () => new Response("", { status: 502 }),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    expect(await gather("https://down.test/")).toMatchObject({
      text: null,
      transient: true,
    });
  });

  it("stops reading at the byte cap, without throwing", async () => {
    const site = web({
      "https://heavy.test/": html(
        `<p>${"Real words here. ".repeat(30)}</p>`,
        `<script>${"x".repeat(GATHER.maxHtmlBytes * 2)}</script>`
      ),
    });
    const { gather } = createGatherer({
      fetch: site.fetch,
      resolve: resolve(),
    });
    const found = await gather("https://heavy.test/");
    // Past the cap: nothing kept, and nothing thrown.
    expect(found.text).toBeNull();
  });
});
