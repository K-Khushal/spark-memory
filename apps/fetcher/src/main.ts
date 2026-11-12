import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { createFetcher } from "@spark/deep-fetch/fetcher";
import { createMediaTools } from "./tools";

// The Deep fetch container (ADR-0010). Cloud Run sets PORT; the secrets come
// from Secret Manager (docs/deploy.md). Nothing about a job is ever logged.
const token = process.env.FETCHER_TOKEN ?? "";
if (!token) {
  console.error("fetcher: FETCHER_TOKEN is not set");
  process.exit(1);
}

const handle = createFetcher({
  token,
  resolve: async (host) =>
    (await lookup(host, { all: true })).map((a) => a.address),
  tools: createMediaTools({
    apiKey: process.env.GEMINI_API_KEY,
    paidTier: process.env.GEMINI_PAID_TIER === "true",
  }),
});

const MAX_BODY = 4_096;

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await handle(
      new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method,
        headers,
        ...(hasBody && { body: Buffer.concat(chunks) }),
      })
    );
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") ?? "text/plain",
    });
    res.end(await response.text());
  } catch {
    console.error("fetcher: request failed");
    res.writeHead(500).end();
  }
}).listen(Number(process.env.PORT ?? 8080), () => {
  console.log("fetcher: listening");
});
