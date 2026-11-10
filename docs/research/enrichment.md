# AI enrichment pipeline: models, extraction, jobs (research, 2026-11-10)

Scope: post-save enrichment for "save anything, find it later". Every item goes through the same flow: fetch or extract the content, make one multimodal LLM call that returns JSON (category, tags, title, summary, entities, OCR, image description), embed the result, and store it.

Prices are USD and were checked on 2026-11-10 unless a row is marked otherwise. Third-party figures are marked *(3p)*. Google no longer publishes per-model free-tier RPM/RPD numbers in its docs. Before you rely on any limit, check the live quota page in AI Studio for your project.

---

## TL;DR: the v1 decision

1. **One structured-output VLM call per item.** Don't add a separate categoriser. `category` is an enum field in the same schema and costs about 10 output tokens.
2. **First pass, $0: Cloudflare Workers AI `@cf/google/gemma-4-26b-a4b-it`.** It accepts images, lists zero data retention, and costs $0.10 / $0.30 per 1M tokens. The free allowance is 10k neurons/day, which covers about 250–450 items/day for $0.
3. **Quality and overflow model: Gemini 3.1 Flash-Lite on the *paid* tier with `service_tier: flex`.** Flex costs $0.125 in / $0.75 out per 1M tokens. That works out to about **$0.50–0.70 per 1,000 items**. It also accepts native PDFs and YouTube URLs, and it enforces the JSON schema. Route scanned PDFs, YouTube links, text-heavy screenshots and Gemma failures here. Using it for everything is the simpler option at about $0.70 per 1,000 items.
4. **Do not send user saves to any Gemini *free* tier, Gemma-on-Gemini-API included.** On the free tier, Google trains on prompts and outputs and lets human reviewers read them. The terms say not to submit personal info, and you can't serve EEA/UK/CH users from it. Turn billing on; at this volume it costs cents.
5. **Use embeddings (needed for search anyway) for zero-shot provisional categories.** They give an instant label and act as the fallback when every LLM quota is used up.
6. **Job queue: Cloudflare Queues** (now on the Free plan, 10k ops/day) or **Supabase pgmq + pg_cron**. Choose whichever matches your backend; don't add Inngest, Trigger.dev or QStash.
7. **Expected cost:** $0 at under ~300 items/day, and about $1–3/month at 2–5k items/month.

---

## 1. Cheap multimodal LLMs for structured extraction

### 1a. Model table

Cost assumptions per item:
- Text item: 3,000 page tokens plus 300 prompt/schema tokens (3.3k in), 400 out.
- Image item: the model's image tokens plus 300 in, 400 out.
- Thinking tokens are excluded. Gemini 3.x and GPT-5.x are thinking models, so set `thinking_level: minimal/low` or `reasoning_effort: minimal`. Otherwise expect output cost to grow by 1–2x.

| Model | $/1M in | $/1M out | Image tokens | Free tier (RPM / RPD) | JSON schema | Free-tier data used for training? | $/1k text items | $/1k image items |
|---|---|---|---|---|---|---|---|---|
| **Gemini 3.1 Flash-Lite** `gemini-3.1-flash-lite` (stable) | 0.25 (Flex/Batch 0.125) | 1.50 (Flex/Batch 0.75) | 280 low / 560 med / **1120 default/high** / 2240 ultra | 10 / 500 *(3p)* | Yes, enforced `response_format` JSON schema | **Yes** (free); No (paid) | 1.43 (Flex 0.71) | 0.96 (Flex 0.48) |
| Gemini 3.5 Flash-Lite `gemini-3.5-flash-lite` (newest Lite) | 0.30 (Flex/Batch 0.15) | 2.50 (1.25) | same as above | 10 / 500 *(3p)* | Yes | **Yes** / No | 1.99 (Flex 1.00) | 1.43 (Flex 0.71) |
| Gemini 2.5 Flash-Lite | 0.10 | 0.40 | ~258/tile | only for projects that already used it | Yes | **Yes** / No | 0.49 | ~0.25 |
| Gemini 3 Flash Preview | 0.50 | 3.00 | 1120 default | preview (lower limits) | Yes | **Yes** / No | 2.85 | 1.91 |
| Gemini 3.6 / 3.8 Flash | 0.75 → **1.50 from 2027-01-01** | 3.75 → **7.50** | 1120 default | 5 / 20 *(3p)* | Yes | **Yes** / No | 3.98 → 7.95 | 2.57 → 5.13 |
| **Gemma 4** (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) via Gemini API | free only, no paid tier | free | image input supported | ~30 / 14,400 *(3p)* | Not officially documented; use prompt-JSON plus validation | **Yes**, always (no paid tier exists) | 0 | 0 |
| **Workers AI Gemma 4 26B A4B** `@cf/google/gemma-4-26b-a4b-it` | 0.10 | 0.30 | not published (assume ≤1.1k) | 10k neurons/day free (≈ $0.11/day) | `response_format` accepted; JSON Mode not guaranteed | No; zero data retention listed | 0.45 | ~0.25 |
| Workers AI Llama 3.2 11B Vision | 0.049 | 0.676 | ~1.6k | shared 10k neurons/day | JSON Mode not listed | No (ZDR) | 0.43 | ~0.35 |
| Workers AI Mistral Small 3.1 24B | 0.351 | 0.555 | ~1k | shared 10k neurons/day | | No (ZDR) | 1.38 | ~0.68 |
| GPT-5.4-nano | 0.20 (Batch/Flex 0.10) | 1.25 (0.625) | 1024² ≈ 1,229 (patches × 1.2) | no free tier | Yes, strict JSON schema | n/a (API not used for training by default) | 1.16 | 0.81 |
| GPT-5.4-mini | 0.75 | 4.50 | same as nano | none | Yes | n/a | 4.28 | 2.95 |
| GPT-5-nano (deprecated, being shut down) | 0.05 | 0.40 | 1024² ≈ 1,536 | none | Yes | n/a | 0.33 | 0.25 |
| GPT-4o-mini | 0.15 | 0.60 | low detail = 2,833 flat; high ≈ 25k | none | Yes | n/a | 0.74 | 0.71 (low) |
| Groq `qwen/qwen3.8-27b` (only GA vision model) | 0.80 | 4.00 | 2,048/image, max 3 images | Developer plan 30 RPM / 1K RPD; free plan values not published | `json_object` mode works with images | Not stated | 4.24 | 3.48 |
| Mistral Small 4 (v26.03) | 0.15 *(3p)* | 0.60 *(3p)* | Vision listed for the Ministral 3 family | Free plan exists, limits unpublished | Yes (Mistral supports JSON schema) | **Yes by default on free**, opt-out in admin | 0.74 | ~0.5 |
| OpenRouter `:free` (e.g. `openrouter/free` router, Nemotron Nano VL, Ling 3.0 Flash VL) | 0 | 0 | varies | 20 RPM; **50 RPD** (<$10 credits) or **1,000 RPD** (≥$10 lifetime credits) | varies by model | **About half the free providers may train** (3p: 9 of 19) | 0 | 0 |

Notes and gotchas:
- **Gemini model churn.** 2.0 Flash/Flash-Lite and 3.1 Flash-Lite Preview are shut down. Starting 2026-12-01, 2.5 Flash requests route to 3.5 Flash-Lite and 2.5 Pro requests route to 3.8 Flash. 2.5 Flash-Lite is the cheapest option, but only projects that already used it can call it. Build against `gemini-3.1-flash-lite` and keep the model ID in config.
- **Gemini 3.x image cost** is set by `media_resolution`, not by pixel count. Use `LOW` (280 tokens) for photos and `HIGH` (1120) for text-heavy screenshots where OCR matters. PDF pages default to 560 tokens.
- **OCR output can be the hidden cost.** A dense screenshot can return 1–2k tokens of OCR text, which costs 3–5x more than the rest of the output. Cap `ocr_text` at roughly 2,000 characters in the prompt. On mobile, run on-device OCR (Android ML Kit, iOS Vision) and send only the text.
- **Workers AI free math.** 10k neurons/day at $0.011 per 1k neurons is $0.11/day. At Gemma 4 prices that covers about 245 text items or about 440 image items per day. Overage requires Workers Paid ($5/mo). On the Free plan, requests simply fail once the allowance is used, which is a clean signal to fall back.
- **Llama 3.2 Vision license:** Meta's multimodal Llama 3.2 license historically excluded EU-domiciled companies. Check before relying on it.
- **Groq** has dropped Llama 4 Scout/Maverick. Its only GA vision model is Qwen 3.8 27B, which is expensive for this workload. Groq is not worth it here.

### 1b. Gemini free-tier terms (important)

From the Gemini API Additional Terms (Unpaid Services):
- Google "uses the content you submit… and any generated responses to provide, improve, and develop" its products and ML technologies. Human reviewers may read and annotate inputs and outputs, after the data is disconnected from your account.
- The terms say: "**Do not submit sensitive, confidential, or personal information to the Unpaid Services.**"
- "You may use only Paid Services when making API Clients available to users in the **EEA**". The same rule covers Switzerland and the UK.
- Paid tier: prompts and responses are **not** used to improve products. They are logged for a limited period for abuse detection only.

**Implication:** A personal memory app's saves (screenshots of chats, receipts, documents) are personal data by default. Use the free tier only for development and testing, or for public content such as public web pages, if you choose. Enabling billing changes the terms for that project even if the bill is $0.40/month.

---

## 2. Separate categoriser vs one call; embedding zero-shot

| Approach | Cost | Quality | Verdict |
|---|---|---|---|
| Separate classifier LLM call, then extraction call | 2x requests, 2x RPM/RPD burn, plus input tokens paid twice | No better: the extraction model already "understands" the item | **No** |
| **One VLM call with `category` as an enum in the schema** | ~10 extra output tokens | Good; the category is consistent with the summary and tags | **Yes, v1** |
| Embedding zero-shot: cosine(item_emb, label_emb) | ~free. bge-m3 on Workers AI $0.012/1M; Gemini Embedding 2 $0.20/1M (text) or $0.45 (image); you need item embeddings for search anyway | OK for distinct categories (recipe vs receipt vs article); weak for subtle ones | **Yes, as a complement** |

How to use embedding zero-shot well:
- Embed a **descriptive label prompt** for each category, not just the bare word. For example: `"recipe: cooking instructions, ingredients, dishes, food blogs"`.
- Embed the enriched `title + summary` when it's available, since raw HTML gives worse labels.
- Uses:
  1. An instant provisional category at save time, before the LLM job runs.
  2. A fallback when every LLM quota is exhausted.
  3. User-created custom categories without changing the prompt or schema.
  4. **k-NN over the user's own corrected items**, which beats label prototypes once a user has ~20 corrections.
- Accept the zero-shot label only when the top-1 cosine minus the top-2 cosine is above a margin, for example 0.03–0.05. Otherwise mark it `uncertain` and let the LLM decide.

---

## 3. Getting content from URLs cheaply

**Order of attempts (cheapest first):**

1. **Client-side capture at save time (best, free).** The web app, browser extension or share sheet already has the rendered DOM and the user's logins. In the extension, run Defuddle in the page and send `{url, html_excerpt or markdown, og meta, optional screenshot}`. This is the **only reliable route for login-walled Instagram/X/TikTok/Facebook content**.
2. **Server fetch plus metadata.** Fetch the URL and parse `og:*`, `twitter:*`, `<title>`, `<meta description>`, JSON-LD (`schema.org` Product/Recipe/Article give prices, dates and authors for free), and the `<link rel=alternate type=json+oembed>` discovery link. In Workers, use `HTMLRewriter`, which streams and uses very little CPU.
3. **Main-content extraction:**
   - **Defuddle** (MIT, from the Obsidian Web Clipper). It replaces Readability, outputs Markdown, and returns metadata plus `schemaOrgData`. It runs in Node with linkedom, JSDOM or happy-dom.
   - **Mozilla Readability** plus linkedom is the conservative alternative.
   - **Caveat:** Workers Free allows **10 ms CPU** per invocation. Building a DOM for a large page can exceed it (error 1102). Prefer client-side extraction, or run server extraction in a Supabase Edge Function (2 s CPU, 150 s wall clock on Free) or in Workers Paid.
4. **Jina Reader `r.jina.ai/<url>`** as a fallback for JS-rendered or messy pages:
   - 20 RPM per IP with no key; 500 RPM with a free key.
   - A new key includes **10M free tokens** (one-time; billing is per output token).
   - It is now Elastic-branded, so treat its long-term terms as uncertain.
5. **Firecrawl** for last-resort JS-heavy pages:
   - Free plan: **1,000 credits/month**, 2 concurrent, 10 RPM `/scrape`.
   - Hobby plan: $19/mo. Skip it for v1.

### Platform specifics

| Source | What works for free | What doesn't |
|---|---|---|
| **YouTube** | `youtube.com/oembed?url=…&format=json` (title, channel, thumbnail, no key). **YouTube Data API v3** `videos.list` (1 unit of the 10k/day free quota) returns description, tags, duration and chapters; that is often enough for a summary. **Gemini YouTube URL input** (`file_data.file_uri`): public videos only, preview, free tier capped at 8 h of video/day, about 100 tokens/s (about 300 at high resolution). A 10-min video is about 60k tokens, roughly $0.015 (Flex ~$0.0075) on 3.1 Flash-Lite. Clip long videos to a window. | Transcript scraping (`youtube-transcript-api`, timedtext) is **blocked from most cloud/serverless IPs** and needs residential proxies or PoToken workarounds. The official captions endpoint only works for your own videos. Client-side, the extension can read caption tracks from the user's browser. |
| **X / Twitter** | `publish.twitter.com/oembed?url=…` (also `publish.x.com`): no auth, returns a `<blockquote>` with **tweet text, author and date**; parse that. og tags are mostly useless. | No images or threads. Third-party JSON proxies (fxtwitter/vxtwitter) are unofficial and may break. The paid X API is not worth it. |
| **Instagram** | **Tokenless Meta oEmbed since 2026-06-15**: `graph.facebook.com/v25.0/instagram_oembed?url=…`, no App Review. | Since 2025-11-03, the response **no longer includes `thumbnail_url`, `author_name` or `author_url`**, only embed `html`. og tags often hit the login wall. Realistic path: extension or share-sheet capture, or a user screenshot run through OCR and the VLM. |
| **TikTok** | `tiktok.com/oembed?url=…`: public, no key, returns **caption as `title`**, `author_name` and `thumbnail_url`. Send the thumbnail to the VLM. | `/photo/` URLs may not be supported. No cheap transcript (Gemini only accepts YouTube URLs). |
| **Facebook / Threads** | Tokenless Meta oEmbed, same as Instagram. | Same field removals. |

---

## 4. PDF text extraction and OCR

| Option | Cost | Where it runs | Use for |
|---|---|---|---|
| **unpdf** (unjs, serverless build of PDF.js) | free | Workers, Node, Bun, browser | `extractText`, `getMeta`, `extractImages`, and `inspectPages` to **detect scanned pages**. No page rendering on Workers (no canvas). **Default for text PDFs.** |
| **pdf.js** in the browser at upload | free | client | Text extraction, plus rendering pages to canvas for client OCR or sending page images. |
| **Gemini native PDF input** | 560 tokens/page default (280 low). A 20-page scan is ~11k tokens, about $0.003 (Flex ~$0.0015) on 3.1 Flash-Lite | API | **Scanned or image PDFs**: OCR, summary and entities in the same structured call. Send only the first N pages for long docs. |
| **Tesseract.js** | free | client (WASM) or Node | Clean printed text. Poor on UI screenshots, emoji and handwriting; slow on phones. Only if you need OCR with zero API calls. |
| **Android ML Kit / iOS Vision text recognition** | free, on-device | mobile apps | **Best free OCR for screenshots on mobile.** Send text instead of the image to save tokens and privacy. |
| **Workers AI `toMarkdown`** | free for most formats; images use AI models (neurons) | Workers | PDF, Office and HTML to Markdown. For images it does object detection plus summarization, **not OCR**. Useful for docx/xlsx. |
| **Mistral OCR 4/4.1** | ~$4/1k pages, $2 batch *(3p)* | API | High-quality layout/table OCR. Overkill for v1. |

**Rule:** run `unpdf.extractText`. If there are fewer than ~100 characters per page, treat it as scanned and send the pages to Gemini. Otherwise send the first ~3k tokens of text to the normal enrichment call.

---

## 5. Background jobs on free tiers

| Service | Free allowance (2026-11) | Fit |
|---|---|---|
| **Cloudflare Queues** | **Yes, on Workers Free**: 10,000 ops/day (~3 ops per message, so ~3.3k messages/day), 24 h retention (fixed), retries plus DLQ, `delaySeconds`, consumer wall time 15 min | **Best if the backend is on Cloudflare.** Pairs with Workers AI, R2 and D1. |
| Cloudflare Workflows | Free: 3,000 steps/day, 10 ms CPU per invocation, 1 GB-month state, 3-day retention | Durable multi-step runs (fetch, then LLM, then embed) with per-step retries. ~4 steps per item is ~700 items/day. Useful, but Queues alone is enough for v1. |
| **Supabase pgmq (Queues) + pg_cron + Edge Functions** | Free: 500k function invocations/mo, 150 s wall / 2 s CPU, 500 MB DB, **project pauses after 1 week of inactivity** | **Best if the backend is on Supabase.** An insert trigger calls `pgmq.send`. pg_cron runs every 30–60 s and calls an Edge Function through `pg_net`. The function reads a batch with a visibility timeout and deletes on success; `read_ct` acts as the retry counter. |
| Inngest | Free: 50k executions/mo (each step counts), 5 concurrent steps; pauses at quota | Good DX with `throttle`, `rateLimit` and retries (free-plan availability not confirmed on the pricing page). Adds a vendor. |
| Trigger.dev | Free: $5 compute credit/mo, 20 concurrent runs, 1-day log retention | Overkill for I/O-bound LLM calls. |
| Upstash QStash | Free: 1,000 messages/day, **retries count as messages**, parallelism 10 (queues: 2), DLQ 3 days | Fine for low volume. The retry billing hurts with 429-heavy free LLMs. |

### Retry and rate-limit handling for free or cheap LLM tiers

- **Provider budget table** (in D1/KV/Postgres): `{provider, rpm_limit, rpd_limit, used_today, reset_at, exhausted_until}`.
  - Gemini RPD resets at midnight Pacific.
  - Workers AI neurons and OpenRouter reset at 00:00 UTC.
  - Gemini quotas are **per project, not per key**, so extra keys don't help.
- **Pace below RPM.** For 10 RPM, consume one message every ~6–7 s: queue `max_concurrency: 1`, batch size 1. Better still, route the steady flow to the paid Flex tier, which has no tight RPM.
- **On 429:**
  1. Read `Retry-After` or Gemini's `RetryInfo.retryDelay`. Re-enqueue with `delaySeconds = max(retryDelay, 2^attempt × 5 s) + jitter`.
  2. If the error says the *daily* quota is exceeded, set `exhausted_until = reset_at` and **route to the next provider immediately** instead of retrying.
- **Flex tier:** a preempted request does *not* auto-upgrade to Standard. Retry Flex twice, then go to Standard.
- **Validate every response** with Zod/JSON Schema. If it fails, make one "repair" retry on the same model with the validation errors, then fall back to the next model.
- **Idempotency:** key the work on `sha256(normalized_content) + prompt_version + model`. If the hash matches an existing result, skip the call; this also dedupes the same link saved twice. Store `enrichment.model` and `prompt_version` so you can re-enrich later.
- **Max attempts:** about 5. After that, send the item to the DLQ, set `status: "failed"` and keep the provisional embedding-based category so the item stays findable.

---

## 6. Recommendation for v1 (~$0–5/month)

### Pipeline

```
save → store raw (R2/Storage) → enqueue job
job:
  1. extract   (client-sent content | HTMLRewriter meta + JSON-LD | Defuddle | oEmbed | unpdf)
               fallback: Jina Reader (free key) → Firecrawl (free 1k/mo)
  2. provisional category via embedding zero-shot (instant)
  3. enrich    one structured VLM call → JSON (schema below)
  4. embed     title + summary + tags + ocr_text  → vector index (pgvector / Vectorize)
  5. status = "enriched"
```

### Model routing and fallback chain

| Step | Provider | When | Cost |
|---|---|---|---|
| 1 | **Workers AI Gemma 4 26B A4B** (ZDR) | while the daily free neurons last (track usage; ~250–450 items/day) | $0 |
| 2 | **Gemini 3.1 Flash-Lite, paid, `service_tier: flex`** | free neurons used up; *or always* for scanned PDFs, YouTube URLs, text-heavy screenshots (`media_resolution: HIGH`), and Gemma JSON/validation failures | ~$0.5–0.7 per 1k items |
| 3 | Gemini 3.1 Flash-Lite, paid, Standard | Flex preempted twice, or the user is waiting (an "enrich now" tap) | ~$1–1.4 per 1k |
| 4 | GPT-5.4-nano (Batch/Flex) | Google outage or account issue (needs a second vendor key) | ~$0.4–0.6 per 1k |
| 5 | Embedding-only result: zero-shot category, og/oEmbed title and description, extracted text | all LLM routes exhausted | ~$0 |
| 6 | Re-enqueue with delay until the next quota reset | | $0 |

**Simpler alternative if quality differences annoy you:** skip step 1 and use Gemini 3.1 Flash-Lite Flex for everything. 1,000 items/month costs about $0.70; 5,000/month costs about $3.50.

Do **not** use for user data: Gemini free tier, Gemma on the Gemini API (free-only), OpenRouter `:free` (about half the providers may train), or Mistral Free (trains by default). They are fine for local development and evals.

Prompting tips:
- Put the category list and output rules in a fixed system prompt, then the item. This lets implicit caching discount the repeated prefix.
- Set `thinking_level` to minimal or low.
- Ask for **null rather than guessing** on entities.
- Keep `temperature` low (0–0.3).

### Sample enrichment JSON schema (Gemini `response_format` and OpenAI strict compatible)

Keep it flat-ish, give it bounded arrays, use enums for the category, and make optional fields nullable. Gemini ignores `maxLength`, so validate lengths in code.

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "enum": ["article", "recipe", "product", "receipt_or_invoice", "event", "place", "travel",
               "video", "social_post", "code_or_tech", "document", "note", "quote_or_idea",
               "person_or_contact", "screenshot_chat", "meme_or_fun", "health", "finance", "other"]
    },
    "category_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "title": { "type": "string", "description": "≤ 80 chars, human-friendly" },
    "summary": { "type": "string", "description": "1–3 sentences, ≤ 400 chars" },
    "tags": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 8,
              "description": "lowercase, singular, no '#'" },
    "language": { "type": "string", "description": "BCP-47, e.g. 'en'" },
    "entities": {
      "type": "object",
      "properties": {
        "people":        { "type": "array", "maxItems": 10, "items": { "type": "string" } },
        "organizations": { "type": "array", "maxItems": 10, "items": { "type": "string" } },
        "places": { "type": "array", "maxItems": 10, "items": {
          "type": "object",
          "properties": { "name": { "type": "string" }, "address": { "type": ["string", "null"] } },
          "required": ["name", "address"] } },
        "products": { "type": "array", "maxItems": 10, "items": {
          "type": "object",
          "properties": {
            "name":     { "type": "string" },
            "brand":    { "type": ["string", "null"] },
            "price":    { "type": ["number", "null"] },
            "currency": { "type": ["string", "null"], "description": "ISO 4217" }
          },
          "required": ["name", "brand", "price", "currency"] } },
        "dates": { "type": "array", "maxItems": 10, "items": {
          "type": "object",
          "properties": {
            "date":  { "type": "string", "format": "date" },
            "label": { "type": "string", "description": "what the date is, e.g. 'event', 'deadline', 'published'" }
          },
          "required": ["date", "label"] } },
        "urls": { "type": "array", "maxItems": 10, "items": { "type": "string" } }
      },
      "required": ["people", "organizations", "places", "products", "dates", "urls"]
    },
    "ocr_text": { "type": ["string", "null"], "description": "visible text in image/scan, ≤ 2000 chars; null if none" },
    "visual_description": { "type": ["string", "null"], "description": "what is shown in the image, ≤ 300 chars; null if no image" },
    "action_items": { "type": "array", "maxItems": 5, "items": { "type": "string" },
                      "description": "e.g. 'buy before 2026-12-01'; empty if none" },
    "is_sensitive": { "type": "boolean", "description": "contains IDs, passwords, medical, financial account data" }
  },
  "required": ["category", "category_confidence", "title", "summary", "tags", "language",
               "entities", "ocr_text", "visual_description", "action_items", "is_sensitive"],
  "additionalProperties": false
}
```

Store these alongside the item and outside the LLM schema: `enrichment.model`, `prompt_version`, `source_kind` (link/text/image/pdf/video), `extracted_text` (from Defuddle/unpdf/oEmbed), `transcript_summary` (videos), `embedding_category` (zero-shot) and `user_category_override`.

### Monthly cost sketch

| Volume | Workers AI free share | Gemini 3.1 Flash-Lite Flex overflow | Total |
|---|---|---|---|
| 1k items/mo (~33/day) | all | 0 | **$0** |
| 10k items/mo (~330/day) | ~8k | ~2k plus PDFs/videos | **~$1.5–3** |
| 30k items/mo | ~10k | ~20k | **~$12–15** (time to charge users or use Batch) |

---

## Sources

- Gemini pricing (incl. Flex/Batch, free vs paid "used to improve"): https://aistudio.google.com/docs/pricing (formerly https://ai.google.dev/gemini-api/docs/pricing)
- Gemini models and deprecations: https://aistudio.google.com/docs/models
- Gemini rate limits (per-project; numbers in AI Studio): https://aistudio.google.com/docs/rate-limits
- Free-tier RPM/RPD figures *(3p)*: https://www.scriptbyai.com/gemini-api-free-tier-limits/ ; https://imisofts.com/blog/gemini-api-free-tier-limits/ ; https://tilnote.io/pages/6a51b3398d9a59d14c1c174c
- Gemini API terms (unpaid vs paid data use, EEA/UK/CH): https://aistudio.google.com/docs/terms
- Gemini media resolution / image & PDF tokens: https://ai.google.dev/gemini-api/docs/media-resolution
- Gemini structured output: https://aistudio.google.com/docs/structured-output
- Gemini video / YouTube URL input: https://aistudio.google.com/docs/video-understanding
- Gemini Flex inference: https://ai.google.dev/gemini-api/docs/flex-inference
- Gemma on Gemini API: https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api ; https://www.philschmid.de/gemma-4-gemini-api ; https://dev.to/ai_made_tools/responsejsonschema-the-undocumented-gemma-4-feature-that-changed-everything-2obm
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI Gemma 4: https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
- Workers AI Llama 3.2 Vision: https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- Workers AI models / JSON mode: https://developers.cloudflare.com/workers-ai/models/ ; https://developers.cloudflare.com/workers-ai/features/json-mode/
- Workers AI toMarkdown: https://developers.cloudflare.com/workers-ai/features/markdown-conversion/ ; https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI image tokens: https://developers.openai.com/api/docs/guides/images-vision
- Groq models / limits / vision: https://console.groq.com/docs/models ; https://console.groq.com/docs/rate-limits ; https://console.groq.com/docs/vision
- Mistral: https://mistral.ai/pricing ; https://docs.mistral.ai/getting-started/models/models_overview/ ; https://www.benchlm.ai/mistral/api-pricing *(3p)* ; https://benchlm.ai/md/free-tier/mistral.md *(3p)*
- Mistral OCR 4 pricing *(3p)*: https://tech-insider.org/mistral-ocr-4-launch-2026/
- OpenRouter limits: https://openrouter.ai/docs/api/reference/limits
- OpenRouter privacy/logging: https://openrouter.ai/docs/guides/privacy/provider-logging
- OpenRouter free-model data policies *(3p)*: https://www.truefoundry.com/blog/openrouter-free-models-whats-actually-free-and-what-it-costs-you
- OpenRouter free router / VL models: https://openrouter.ai/openrouter/free ; https://openrouter.ai/models/inclusionai/ling-3.0-flash-vl:free
- Jina Reader: https://jina.ai/reader/
- Firecrawl: https://www.firecrawl.dev/pricing
- Defuddle: https://github.com/kepano/defuddle
- unpdf: https://github.com/unjs/unpdf
- YouTube transcript blocking: https://github.com/jdepoix/youtube-transcript-api ; https://dev.to/jamhimself/why-your-youtube-transcript-scraper-started-returning-empty-strings-and-how-to-fix-it-in-2026-20ed
- Meta tokenless oEmbed (2026-06-15): https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis/
- Meta oEmbed field removals: https://developers.facebook.com/blog/post/2025/04/08/oembed-updates/ ; https://iframely.com/updates/193071-facebook-and-instagram-oembed-thumbnail-deprecation
- X oEmbed: https://developer.x.com/en/docs/x-for-websites/oembed-api
- TikTok oEmbed: https://developers.tiktok.com/docs/en/embed-videos ; https://core.trac.wordpress.org/ticket/64941
- Cloudflare Queues pricing: https://developers.cloudflare.com/queues/platform/pricing/
- Cloudflare Workflows pricing: https://developers.cloudflare.com/workflows/reference/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Supabase pricing / Edge Function limits / Queues: https://supabase.com/pricing ; https://supabase.com/docs/guides/functions/limits ; https://supabase.com/docs/guides/queues
- Inngest: https://www.inngest.com/pricing
- Trigger.dev: https://trigger.dev/pricing
- Upstash QStash: https://upstash.com/pricing/qstash
