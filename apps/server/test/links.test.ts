import { afterEach, describe, expect, it, vi } from "vitest";
import {
  databaseUrl,
  drain,
  env,
  fakeTurnstile,
  queues,
  signedIn,
} from "./worker";

// Link Capture through the Worker: the route, the queue consumer gathering
// the Source, real Postgres. The web (and DNS over HTTPS) is stubbed at fetch.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Memory = {
  id: string;
  kind: string;
  sourceUrl: string | null;
  pageTitle: string | null;
  description: string | null;
  body: string | null;
  preservation: string;
  indexState: string;
  lastSavedAt: string;
};

const ARTICLE = "Basil wants six hours of light and warm soil. ".repeat(12);

/** The public web as a few pages; DNS says every name is public unless listed. */
function stubWeb(pages: Record<string, string>, privateNames: string[] = []) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") {
      const name = url.searchParams.get("name")!;
      const type = url.searchParams.get("type");
      const data = privateNames.includes(name) ? "10.0.0.7" : "93.184.215.14";
      return Response.json({
        Answer: type === "A" ? [{ type: 1, data }] : [],
      });
    }
    asked.push(url.href);
    const page = pages[url.href];
    return page === undefined
      ? new Response("", { status: 404 })
      : new Response(page, { headers: { "content-type": "text/html" } });
  });
  return asked;
}
afterEach(() => vi.restoreAllMocks());

const page = (title: string, body: string) =>
  `<html><head><title>${title}</title><meta property="og:description" content="About ${title}"></head><body><article><p>${body}</p></article></body></html>`;

async function captureLink(call: Call, url: string, id = crypto.randomUUID()) {
  const res = await call("/api/memories/links", {
    method: "POST",
    json: { id, url },
  });
  return { status: res.status, memory: (await res.json()) as Memory, id };
}
const read = async (call: Call, id: string) =>
  (await (await call(`/api/memories/${id}`)).json()) as Memory;
const search = async (call: Call, q: string) =>
  (
    (await (await call(`/api/search?q=${encodeURIComponent(q)}`)).json()) as {
      results: Memory[];
    }
  ).results.map((m) => m.id);

describe.skipIf(!databaseUrl)("link Capture", () => {
  it("Captures a link at once, then gathers it: Preserved, searchable by its page", async () => {
    const { call } = await signedIn();
    const url = "https://garden.test/basil?utm_source=mail";
    const { status, memory } = await captureLink(call, url);
    expect(status).toBe(201);
    expect(memory).toMatchObject({
      kind: "link",
      sourceUrl: url,
      indexState: "indexing",
      preservation: "reference_only",
    });
    expect(queues.fresh.sent.map((m) => m.body.memoryId)).toContain(memory.id);

    const asked = stubWeb({
      "https://garden.test/basil": page("Growing Basil", ARTICLE),
    });
    const [message] = await drain(memory.id);
    expect(message!.ack).toHaveBeenCalled();
    // Fetched without its tracking parameters.
    expect(asked).toEqual(["https://garden.test/basil"]);
    expect(await read(call, memory.id)).toMatchObject({
      indexState: "searchable",
      preservation: "preserved",
      pageTitle: "Growing Basil",
      description: "About Growing Basil",
      body: ARTICLE.trim(),
    });
    expect(await search(call, "warm soil")).toContain(memory.id);
    expect(await search(call, "garden")).toContain(memory.id);
  });

  it("answers a second Capture of the same page with the Memory already saved", async () => {
    const { call } = await signedIn();
    const first = await captureLink(call, "https://news.test/a?id=1");
    const again = await captureLink(call, "https://news.test/a?id=1&fbclid=x");
    expect(again.status).toBe(200);
    expect(again.memory.id).toBe(first.memory.id);
    expect(again.memory.lastSavedAt > first.memory.lastSavedAt).toBe(true);
    // Nothing new to Index.
    expect(
      queues.fresh.sent.filter((m) => m.body.memoryId === again.id)
    ).toEqual([]);
  });

  it("refuses what is not an http(s) link", async () => {
    const { call } = await signedIn();
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "hello"]) {
      expect((await captureLink(call, url)).status).toBe(400);
    }
  });

  it("never fetches a private address, and keeps the link Reference only", async () => {
    const { call } = await signedIn();
    const { memory } = await captureLink(
      call,
      "https://intranet.corp.test/wiki"
    );
    const asked = stubWeb({}, ["intranet.corp.test"]);
    await drain(memory.id);
    expect(asked).toEqual([]);
    expect(await read(call, memory.id)).toMatchObject({
      indexState: "searchable",
      preservation: "reference_only",
      body: null,
    });
    expect(await search(call, "intranet")).toContain(memory.id);
  });

  it("keeps Jina Reader off unless the environment turns it on", async () => {
    const { call } = await signedIn();
    const url = "https://app.test/";
    const { memory } = await captureLink(call, url);
    const asked = stubWeb({ [url]: page("App", "") });
    await drain(memory.id);
    expect(asked.some((u) => u.includes("r.jina.ai"))).toBe(false);

    const second = await captureLink(call, "https://app2.test/");
    const asked2 = stubWeb({ "https://app2.test/": page("App", "") });
    await drain(second.memory.id, env({ LINK_READER: "jina" }));
    expect(asked2).toContain(`https://r.jina.ai/https://app2.test/`);
  });
});
