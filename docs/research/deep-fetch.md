# Deep fetch: engines, free tiers and yt-dlp (#21)

Checked 12 November 2026 for #21 with web search only (the vendor pages were not opened one by one). **Re-check every number before relying on it**; each one is a config value in `packages/core/lib/deep-fetch.ts`.

## Cloudflare Browser Rendering (pages that need JavaScript)

- The Workers Free plan gets **10 minutes of browser time a day and 3 concurrent browsers**; past that the API answers HTTP 429 until the next UTC day. The product is now also named Browser Run in Cloudflare's docs. [Limits](https://developers.cloudflare.com/browser-rendering/limits/), [changelog](https://developers.cloudflare.com/changelog/product/browser-rendering).
- A third-party summary lists 6 requests a minute on Free; Cloudflare's own page is the one to confirm. Per-endpoint limits for `/content` and `/screenshot` were not found.
- **How Spark uses it**: the REST API (`POST /accounts/{id}/browser-rendering/content` and `/screenshot`), not the Workers puppeteer binding, because the binding needs `@cloudflare/puppeteer` in a Worker that must stay small. Needs the account id and an API token that may only use Browser Rendering. `content` returns the rendered HTML, read by the same scanner as gathering; `screenshot` is a 1280×800 JPEG at quality 60, kept only under 400 KB.
- **Budget**: `DEEP_FETCH.budgets.page` is 540 s a UTC day (90% of the limit). Each job's wall time is added to `deep_fetch_usage`; a job that finds the day spent, or gets a 429, waits for the next day and does not use one of its attempts.
- **Safety**: Cloudflare's browser follows redirects and loads subresources itself, so per-hop checks cannot be made on its side. Spark checks the URL and every redirect with the #16 guard (`publicFetch`) first, and sends the browser only the final public URL. Cloudflare's network refuses private destinations for what the page loads afterwards. No cookie, login, header or user agent of anyone's is sent (a test asserts the request bodies).
- Not a bot-detection bypass: Browser Rendering identifies itself as a bot; a page that refuses it stays Reference only.

## Google Cloud Run (video and audio)

- Always-free, request-based billing: **180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month**, in the free-tier regions (us-central1 and similar Tier 1 regions). Instance-based billing lists 240,000 vCPU-seconds and 450,000 GiB-seconds; sources disagree slightly, so Spark uses the smaller. Outbound data is about 1 GiB a month free within North America. [Pricing](https://cloud.google.com/run/pricing).
- **Budget**: `DEEP_FETCH.budgets.media` is 150,000 s a month (one vCPU, so job seconds are vCPU-seconds, with margin for startup). A job that finds the month spent is queued with its due time at the first of next month (the database holds the time; the hourly sweep sends it, because a queue holds a message 24 hours at most). No job ever runs past the free tier, so none can cost money. A Cloud Run 429 or 503 is also treated as out of free tier.
- Deployed with one vCPU, concurrency 1, min instances 0 and at most 2 instances, which is what keeps it inside the free tier.
- **Cost not covered by the free tier**: the Gemini transcript. Audio is about 32 tokens a second (1,920 a minute), so an hour is about 115,000 input tokens. Spark prices it at Flash-Lite's text input price (`INDEXING.pricesMicrosPerMTokens`), recorded per Memory in `ai_call` and counted against the daily AI budget; audio is priced higher than text on some Gemini models, so the admin page may under-count. Check before enabling at scale.

## yt-dlp

- YouTube support now needs an **external JavaScript runtime** (since 2025.11.12); Deno is the one enabled by default and recommended, Node, QuickJS and Bun work when enabled with `--js-runtimes`. Bun support was announced as being phased out in May 2026. The EJS challenge solver is bundled in the official standalone binaries. [Gigazine, 2025](https://www.gigazine.net/gsc_news/en/20251113-yt-dlp-required-deno-javascript-runtime), [Gigazine, 2026](https://gigazine.net/gsc_news/en/20260525-yt-dlp-bun).
- **How Spark uses it**: the standalone `yt_dlp_linux` binary in a `node:22-slim` image, with `--js-runtimes node` (Node is already in the image). `--ignore-config` and no cookie, login or header flag at all (a test asserts it).
- YouTube blocks many datacentre IPs and changes often. **Expect Deep fetch of YouTube to fail for some videos**, and the container to need a rebuild when yt-dlp changes (the build takes the current release unless `YT_DLP_VERSION` pins one). Never work around a block with accounts, cookies, proxies or PoToken tricks (ADR-0010); the Memory stays Reference only and shows Failed with Try Again.
- Only YouTube and Vimeo video pages are fetched (`isVideoUrl`), and only when the host resolves to public addresses. yt-dlp follows redirects itself, which is why it is not pointed at arbitrary hosts.

## Decisions

- **One state machine on the Memory** (`deep_fetch_state`: queued, running, done, failed, unavailable), fenced by `deep_fetch_run` and the Memory's `index_generation`, so a late message, Try Again or a deleted-and-recreated id can never write. Attempts: now, after 1 hour, after 24 hours, then Failed; Try Again starts a new run.
- **Thin** means a link with no Preserved text or no image URL, or a video whose transcript is unavailable (`isThin`). A video over the 60-minute allowance is not thin.
- **Limits**: 20 a person a UTC day (`usage_day`), counted per attempt; the engine budgets above; the daily AI budget for video (it spends model tokens). Waiting for a limit never uses an attempt.
- **AI opt-out**: a page may be fetched (no AI reads it); a video is never fetched (audio goes to a model). Switching opt-out on stops a queued video job.
- **Deferred**: keyframes for Visual vectors and a headless browser in the container (the audio path needs neither), a transcript for video the person owns, content hashes for deep-fetched text.
