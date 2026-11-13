import {
  isTransient,
  publicFetch,
  readPage,
  type Resolve,
} from "@spark/indexing";
import { MIN_PRESERVED_CHARS, SCREENSHOT_MAX_BYTES } from "@spark/core";
import type { Engine, EngineResult } from "./engine";

const API = "https://api.cloudflare.com/client/v4/accounts";
const VIEWPORT = { width: 1280, height: 800 } as const;
/** One call's limit: a page that has not settled by then is what it is. */
const GOTO = { waitUntil: "networkidle2", timeout: 20_000 } as const;
const CALL_TIMEOUT_MS = 40_000;
/** Images, media and fonts are not needed to read a page. */
const SKIP = ["image", "media", "font"] as const;

const seconds = (since: number) => Math.ceil((Date.now() - since) / 1000);

/**
 * Cloudflare Browser Rendering (ADR-0010) for pages that need JavaScript:
 * its REST API loads the page in Cloudflare's browser and returns the
 * rendered HTML (read for text exactly as gathering reads a page) and a
 * visible-area screenshot. Free plan: 10 browser minutes a UTC day, so a 429
 * is `limit`, which waits for the next day. Docs/research/deep-fetch.md.
 *
 * The page's address and every redirect on the way are checked with the
 * public-fetch guard first (#16): the browser is only ever sent a URL on the
 * public web. Cloudflare's own network refuses private destinations for
 * what the page loads afterwards. Never sends a cookie, a login or a header
 * of anyone's: only the account's API token, to Cloudflare.
 */
export function cloudflareBrowser({
  accountId,
  apiToken,
  fetch: send = fetch,
  resolve,
}: {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
  resolve: Resolve;
}): Engine {
  const call = (path: "content" | "screenshot", body: unknown) =>
    send(`${API}/${encodeURIComponent(accountId)}/browser-rendering/${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  return {
    async fetch({ url }): Promise<EngineResult> {
      const started = Date.now();
      const failed = (reason: "not_public" | "nothing" | "error" | "limit") =>
        ({ ok: false, reason, seconds: seconds(started) }) as const;

      // The Source must be public; one that answered badly (a bot wall's
      // 403) is exactly what this is for, but is still only ever that URL.
      const page = await publicFetch(url, { fetch: send, resolve });
      let target = url;
      if (page.ok) target = page.url;
      else if (!page.confirmed) {
        return failed(isTransient(page.reason) ? "error" : "not_public");
      }

      const options = {
        url: target,
        gotoOptions: GOTO,
        rejectResourceTypes: SKIP,
      };
      let html: string;
      try {
        const res = await call("content", options);
        if (res.status === 429) return failed("limit");
        if (!res.ok) return failed("error");
        const body = (await res.json()) as { result?: unknown };
        if (typeof body.result !== "string") return failed("error");
        html = body.result;
      } catch {
        return failed("error");
      }
      const found = readPage(html);
      const text = found.text.length >= MIN_PRESERVED_CHARS ? found.text : "";

      // The screenshot is a bonus: any failure here keeps the text.
      let screenshot;
      try {
        const res = await call("screenshot", {
          ...options,
          viewport: VIEWPORT,
          screenshotOptions: { type: "jpeg", quality: 60 },
        });
        if (res.ok && res.headers.get("content-type")?.startsWith("image/")) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length > 0 && bytes.length <= SCREENSHOT_MAX_BYTES) {
            screenshot = { bytes, ...VIEWPORT };
          }
        }
      } catch {
        // Nothing to keep.
      }

      return {
        ok: true,
        seconds: seconds(started),
        ...(text && { text }),
        metadata: found.metadata,
        ...(screenshot && { screenshot }),
      };
    },
  };
}
