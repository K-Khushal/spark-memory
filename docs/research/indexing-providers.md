# Indexing providers: Workers AI Gemma 4, Gemini Flash-Lite, Queues, Postgres FTS

Researched 2026-11-11 from primary docs. "UNVERIFIED" means no cited page states it; test before relying on it.

## 1. Workers AI `@cf/google/gemma-4-26b-a4b-it`

Sources: model page [M] https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ , its input schema [SI] https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-input.json and output schema [SO] https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-output.json

- Model id `@cf/google/gemma-4-26b-a4b-it` exists. Tagged Function calling, Reasoning, Vision, Batch, Zero data retention. Context window 256,000 tokens. [M]
- Input is `{ prompt }` or `{ messages }` (oneOf). Roles: `developer`, `system`, `user`, `assistant`, `tool`, `function`. [SI]
- User `content` is a string or an array of parts. A part is `{ type: "text" | "image_url" | "video_url" | "input_audio" | "file", text?, image_url?: { url, detail?: "auto"|"low"|"high" } }`. System content is text only. [SI]
- A `data:` URI in `image_url.url` is UNVERIFIED: the schema only says `url: string`. There is no `image: number[]` field in this model's schema. [SI]
- `response_format` accepts `{type:"text"}`, `{type:"json_object"}` or `{type:"json_schema", json_schema:{ name (required), description?, schema?, strict? }}` (OpenAI shape). [SI]
- The JSON Mode page's supported-models list does NOT include Gemma 4. It lists llama-3.3-70b-fp8-fast, llama-3-8b, llama-3.1-8b, hermes-2-pro, deepseek-coder-6.7b, deepseek-r1-distill-qwen-32b. Its example puts the JSON Schema directly in `json_schema`, with no `name` or `schema` wrapper. That differs from Gemma 4's schema. Workers AI "can't guarantee" compliance and returns a "JSON Mode couldn't be met" error. JSON Mode doesn't support streaming. https://developers.cloudflare.com/workers-ai/features/json-mode/
  - Net: the field is accepted by Gemma 4's schema, but enforcement is UNVERIFIED. Validate output with Zod and handle the error.
- Other inputs: `max_tokens` is "Deprecated in favor of max_completion_tokens". No default is documented for either: UNVERIFIED. `temperature` defaults to 1 (0–2). `chat_template_kwargs.enable_thinking` defaults to **true**, so reasoning is on unless you set it to `false`. Reasoning tokens bill as output. [SI]
- Output is OpenAI chat-completion shaped: `{ id, object, created, model, choices: [{ index, message: { role:"assistant", content: string|null, refusal, tool_calls? }, finish_reason: "stop"|"length"|"tool_calls"|"content_filter"|"function_call", logprobs }], usage?: { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details?{cached_tokens}, completion_tokens_details?{reasoning_tokens} }, system_fingerprint }`. There is **no top-level `response` field**. `usage` is not in `required`, so treat it as optional. [SO]
- Vision limits (max images, max bytes, resolution) are not stated: UNVERIFIED. [M] Workers AI error 3006 / HTTP 413 means "Request is too large". https://developers.cloudflare.com/workers-ai/platform/errors/
- Price: $0.100 per M input tokens = 9,091 neurons. $0.300 per M output tokens = 27,273 neurons. https://developers.cloudflare.com/workers-ai/platform/pricing/
- Free allocation: 10,000 neurons/day, reset 00:00 UTC. Above it, $0.011 per 1,000 neurons on Workers Paid. On Free, "further operations will fail with an error". https://developers.cloudflare.com/workers-ai/platform/pricing/
- Exhaustion and rate signals: https://developers.cloudflare.com/workers-ai/platform/errors/
  - 3036, HTTP 429: "You have used up your daily free allocation of 10,000 neurons."
  - 3040, HTTP 429: "Capacity temporarily exceeded, please try again." Also returned when `rejectIfBusy` rejects.
  - 5035, HTTP 403: "This model requires a Workers Paid plan."
  - No separate generic rate-limit code is listed.
  - How the binding surfaces these (thrown `Error` whose message contains the code or text) is UNVERIFIED. Match on both `3036` and the "daily free allocation" text.
- Data: "Workers AI processes Customer Content only for as long as needed to provide the service". Cloudflare "does not retain inputs or outputs after they are no longer needed to process the request" (excludes stateful features and AI Gateway logging you enable). It "does not use Customer Content processed by Workers AI to train AI models." https://developers.cloudflare.com/workers-ai/platform/data-usage/

## 2. Gemini API (paid tier), Flash-Lite

- Ids, from https://aistudio.google.com/docs/models (ai.google.dev/gemini-api/docs/* now 301-redirects to aistudio.google.com/docs/*):
  - `gemini-3.5-flash-lite`: Stable. Input limit 1,048,576 tokens, output limit 65,536. Supports structured outputs. https://aistudio.google.com/docs/models/gemini-3.5-flash-lite
  - `gemini-3.1-flash-lite`: Stable, same limits, supports structured outputs. https://aistudio.google.com/docs/models/gemini-3.1-flash-lite
  - `gemini-3.1-flash-lite-preview` is shut down.
  - `gemini-2.5-flash` is deprecated and routes to `gemini-3.5-flash-lite` on 2026-12-01.
  - `gemini-2.5-flash-lite` is open only to past users.
- Paid prices per 1M tokens (output includes thinking tokens). https://aistudio.google.com/docs/pricing

  | model | Standard in / out | Batch & Flex in / out | Priority in / out |
  |---|---|---|---|
  | gemini-3.5-flash-lite | $0.30 (text/image/video/audio) / $2.50 | $0.15 / $1.25 | $0.54 / $4.50 |
  | gemini-3.1-flash-lite | $0.25 (text/image/video), $0.50 audio / $1.50 | $0.125 / $0.75 | $0.45 / $2.70 |

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`. https://aistudio.google.com/api-reference/generate-content/generate-content
  - The guides authenticate with header `x-goog-api-key: $GEMINI_API_KEY`. https://aistudio.google.com/docs/text-generation
  - The API reference curl examples use `?key=`.
  - Note: the guides now default to a newer `POST /v1beta/interactions` API (header `Api-Revision: 2026-05-20`, body `{model, input, response_format:{type:"text", mime_type:"application/json", schema}}`). generateContent is not marked deprecated. https://aistudio.google.com/docs/structured-output
- generateContent request body:
  - `contents: [{ role?, parts: [{ text } | { inlineData: { mimeType, data /*base64*/ } }] }]`
  - `systemInstruction: Content`, text only
  - `generationConfig: { responseMimeType: "application/json", responseJsonSchema: {...}, maxOutputTokens, thinkingConfig: { thinkingLevel: MINIMAL|LOW|MEDIUM|HIGH | thinkingBudget, includeThoughts }, mediaResolution: MEDIA_RESOLUTION_LOW(64 tok)|MEDIUM(256)|HIGH }`
  - The REST reference lists `responseJsonSchema` and no `responseSchema` field in GenerationConfig. The SDK examples on the same page still use `responseSchema`. Use `responseJsonSchema` over REST.
  - `temperature`, `topP` and `topK` are "silently ignored on Gemini 3.6 Flash and newer models".
  - REST examples use snake_case `inline_data`/`mime_type`. Proto JSON accepts both spellings: UNVERIFIED, but standard for Google APIs.
  - Source: https://aistudio.google.com/api-reference/generate-content/generate-content
- Response `usageMetadata`: `{ promptTokenCount, cachedContentTokenCount, candidatesTokenCount, toolUsePromptTokenCount, thoughtsTokenCount, totalTokenCount, promptTokensDetails[] }`. The text is at `candidates[0].content.parts[].text`. Same source.
- Structured-output schema keywords:
  - Types: string/number/integer/boolean/object/array/null.
  - Supported keywords: `properties`, `required`, `additionalProperties`, `enum`, `format`, `minimum`/`maximum`, `items`, `prefixItems`, `minItems`/`maxItems` (enforced).
  - `minLength`, `maxLength` and similar keywords are silently stripped.
  - Overly complex schemas return `400 INVALID_ARGUMENT`.
  - Source: https://aistudio.google.com/docs/structured-output
- Images:
  - Inline request total (prompt + system instruction + bytes) is capped at 20 MB. Larger inputs go through the File API.
  - MIME types: png/jpeg/webp/heic/heif.
  - Up to 3,600 images per request.
  - Token cost: 258 tokens if both sides are ≤384 px, else 258 per 768×768 tile.
  - Source: https://aistudio.google.com/docs/image-understanding
- Data use: on the Free (unpaid) tier, content is used "to provide, improve, and develop Google products" and human reviewers may read it. The API is a Paid Service "only when accessing the API through a Cloud Project associated with an active billing account". Then Google doesn't use prompts or responses to improve products and logs them "for a limited period of time" for abuse detection. https://aistudio.google.com/docs/terms
- Paid tier is decided per billing account and Cloud project: "Tiers, rate limits, and billing account caps are all determined at the billing account level". Upgrading means linking billing and prepaying at least $5. https://aistudio.google.com/docs/billing
  - None of the cited pages documents a request field or header that forces or reports the paid tier. The only guarantee is to use a key from a billed project.

## 3. Cloudflare Queues

- wrangler.jsonc `queues.producers[]: { queue, binding }`. https://developers.cloudflare.com/queues/configuration/configure-queues/
- `queues.consumers[]` keys (same source):
  - `queue`
  - `max_batch_size`: default 10, max 100.
  - `max_batch_timeout`: default 5 s, max 60.
  - `max_retries`: default 3, max 100.
  - `dead_letter_queue`: auto-created. If unset, failing messages are discarded.
  - `max_concurrency`: unset means scale to the max (250).
  - `retry_delay`: seconds, documented at https://developers.cloudflare.com/queues/configuration/batching-retries/
  - Limits from https://developers.cloudflare.com/queues/platform/limits/
- Queue-level `--delivery-delay-secs` (0–86400) is a CLI setting, not a wrangler key. https://developers.cloudflare.com/queues/configuration/configure-queues/
- JS API, from https://developers.cloudflare.com/queues/configuration/javascript-apis/
  - `send(body, { contentType?: "text"|"bytes"|"json"|"v8", delaySeconds?: 0..86400 })`. `delaySeconds: 0` overrides a queue default.
  - `msg.retry({ delaySeconds })`, `msg.ack()`, `batch.retryAll({ delaySeconds })`, `batch.ackAll()`.
  - `msg.attempts` "Starts at 1".
  - Handler: `async queue(batch, env, ctx)`.
- Max delay is **24 h** (86,400 s) for send and retry. https://developers.cloudflare.com/queues/platform/limits/
- Limits (same source):
  - Message ≤128 KB (1 KB = 1000 B, ~100 B of metadata included).
  - `sendBatch` takes ≤100 messages or 256 KB.
  - 5,000 msg/s per queue. Above that, `send` throws "Too Many Requests".
  - Consumer wall time 15 min. Consumer CPU defaults to 30 s, configurable to 5 min via `limits.cpu_ms`.
  - One consumer Worker per queue. https://developers.cloudflare.com/queues/get-started/
- Priority: no priority feature is documented, and delivery order is not guaranteed. Use one queue per priority, or per-message delay. https://developers.cloudflare.com/queues/reference/how-queues-works/ (via search of developers.cloudflare.com; no page describes priority)
- Free plan: Queues is included on Workers Free with 10,000 operations/day. An operation is each 64 KB written, read or deleted, so a normal message costs about 3 ops (write + read + delete). Paid: 1M ops/month included, then $0.40/M. https://developers.cloudflare.com/queues/platform/pricing/
  - What happens past 10k/day on Free is not stated: UNVERIFIED.
  - Retention on Free is fixed at 24 h. Paid is configurable up to 14 days. https://developers.cloudflare.com/queues/platform/limits/
- Local dev: `wrangler dev` simulates queues via Miniflare. `--remote` is not supported, and consumer concurrency is not simulated locally. https://developers.cloudflare.com/queues/configuration/local-development/
  - The get-started guide puts producer and consumer "in the same Worker project", so one Worker can consume its own queue. https://developers.cloudflare.com/queues/get-started/

## 4. Postgres built-in text search configurations (PG 16 and 17 identical)

- `simple` is defined in the catalog. https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/include/catalog/pg_ts_config.dat
- One Snowball config per language, generated by `snowball_create.pl`. The list is identical on REL_16_STABLE and REL_17_STABLE:
  - https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/snowball/snowball_create.pl
  - https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/snowball/snowball_create.pl
- The 28 language configs: arabic, armenian, basque, catalan, danish, dutch, english, finnish, french, german, greek, hindi, hungarian, indonesian, irish, italian, lithuanian, nepali, norwegian, portuguese, romanian, russian, serbian, spanish, swedish, tamil, turkish, yiddish. All 28 plus `simple` match the expected list exactly. There is no `porter` config.
- Only 15 of them ship stop-word files: danish, dutch, english, finnish, french, german, hungarian, italian, nepali, norwegian, portuguese, russian, spanish, swedish, turkish. https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/snowball/Makefile
- BCP-47 primary subtag mapping: ar, hy, eu, ca, da, nl, en, fi, fr, de, el, hi, hu, id, ga, it, lt, ne, nb/nn/no→norwegian, pt, ro, ru, sr, es, sv, ta, tr, yi. Everything else (zh, ja, ko, th, …) maps to `simple`.

## Contradictions with the earlier stack notes

1. **Flash-Lite prices were Batch/Flex prices, not Standard.** Standard (synchronous) paid prices are higher. https://aistudio.google.com/docs/pricing
   - `gemini-3.5-flash-lite`: $0.30 in / $2.50 out. The earlier $0.15 / $1.25 is the Batch/Flex price.
   - `gemini-3.1-flash-lite`: $0.25 in / $1.50 out. The earlier $0.125 / $0.75 is Batch/Flex.
2. **Gemma 4 structured output, partially resolved.** Its schema accepts `response_format` json_object or json_schema. But Gemma 4 is missing from the JSON Mode supported list, and the JSON Mode page uses a different `json_schema` shape. Enforcement is still unconfirmed.
3. **Gemma 4 output is `choices[0].message.content`, not `response`.** Thinking is on by default (`enable_thinking: true`), so output-token cost can grow. Not a contradiction of a stated claim, but it changes the parser and the cost model.
4. **Queue delay max is 24 h, not 12 h.** 12 h is the pull-consumer `visibilityTimeout`.
5. **10k ops/day ≠ 10k messages/day.** Each message costs about 3 operations (write, read, delete).
6. **Confirmed unchanged:**
   - Gemma 4 id and $0.10 / $0.30 per M.
   - Workers AI 10,000 neurons/day free, reset 00:00 UTC, $0.011 per 1k neurons.
   - Queues has no priority feature.
   - Queues Free plan allows 10,000 operations/day.
