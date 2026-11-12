# Gathering pasted links on the server

Checked 11 November 2026 for #16. Re-check before relying on a number.

## What runs by default

Pasted links are gathered by the Worker itself (ADR-0006's server-side fallback), with no third party:

- the page's HTML (Open Graph, `twitter:` tags, `<title>`, JSON-LD, readable text from `<article>`, `<main>` or the body), read with a linear scanner in `packages/indexing/lib/link/html.ts`, capped at 256 KB so it fits the Worker's CPU budget (about 24 ms of CPU per MB measured, so about 6 ms at the cap; ADR-0006, Amendment). HTMLRewriter would be cheaper still but does not exist in Node, where the tests run; the scanner is one `indexOf` pass with no regex over the page, so a hostile page cannot make it backtrack;
- oEmbed: only a fixed list of endpoints (YouTube, X, TikTok, Vimeo, Spotify, Reddit), built from the Source's host. An `application/json+oembed` link a page names is never followed: the page is untrusted, and its link could point the Worker anywhere. Instagram's oEmbed needs a Meta app token, so it is left out (the extension, #17, covers it);
- names resolve through Cloudflare's DNS over HTTPS (`cloudflare-dns.com/dns-query`, JSON API), because Workers has no resolver. Workers' `fetch` resolves again, so the check cannot rule out DNS rebinding; Cloudflare refuses private destinations from Workers on its own, and the check is what protects local development.

## Jina Reader (off unless `LINK_READER` is `"jina"`)

- Works without a key at about 20 requests a minute; a free key comes with starter tokens and a higher limit. Sources disagree on the exact numbers (1M or 10M starter tokens, 200 or 500 requests a minute with a key), and Jina's own rate-limit page was not captured: [jina.ai/reader](https://jina.ai/reader), [activepieces pricing summary, 2026](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026).
- Jina fetches the page from its own servers, so it sees every link it reads. No source found states how Jina keeps request URLs or content; its privacy policy needs reading before turning it on.
- **Owner decision**: whether Spark sends links whose page needs a browser to Jina (better readable text for JavaScript-only pages) or waits for Deep fetch (#19, Browser Rendering, no third party). Until then it stays off, and it is never used for a Memory with AI opt-out.
