# Embeddings: Gemini Embedding 2 and pgvector

Researched 2026-11-11 from primary docs. "UNVERIFIED" means no cited page states it; test before relying on it.

Note: ai.google.dev/gemini-api/docs/* now 301-redirects to aistudio.google.com/docs/*.

## 1. Gemini Embedding 2

Sources:
- [E] guide: https://aistudio.google.com/docs/embeddings
- [MP] model page: https://aistudio.google.com/docs/models/gemini-embedding-2
- [AR] API reference: https://aistudio.google.com/api-reference/embeddings , https://aistudio.google.com/api-reference/embeddings/embed-content , https://aistudio.google.com/api-reference/embeddings/batch-embed-contents
- [P] pricing: https://aistudio.google.com/docs/pricing
- [B] Batch API: https://aistudio.google.com/docs/batch-api
- [RL] rate limits: https://aistudio.google.com/docs/rate-limits
- [T] terms: https://aistudio.google.com/docs/terms

### Model id and endpoints

- Id `gemini-embedding-2`. Stable. Latest update April 2026. Multimodal input: text, image, video, audio, PDF. [MP]
- The older text-only `gemini-embedding-001` is also stable. [E]
- Single: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent` [E] [AR]
- Several in one call: `POST .../models/gemini-embedding-2:batchEmbedContents` with `{ requests: [EmbedContentRequest, ...] }`. Each item needs its own `model: "models/gemini-embedding-2"`, which must match the path model. [AR]
- Async Batch API: `POST .../models/{model}:asyncBatchEmbedContent` enqueues an `EmbedContentBatch` (`model`, `displayName`, `inputConfig` with `fileName` or inline `requests`). Output is a JSONL `responsesFile` or `inlinedResponses`. [AR] The guide uses the SDK `batches.create_embeddings` with `model="gemini-embedding-2"`. Target turnaround 24 hours. Input file up to 2 GB; inline under 20 MB total. [B]
- No maximum count of `requests` per `batchEmbedContents` is stated: UNVERIFIED. [AR]

### Request body

Text (from the REST example) [E]:

```json
{
  "model": "models/gemini-embedding-2",
  "content": { "parts": [{ "text": "..." }] },
  "output_dimensionality": 768
}
```

- Image part: `{ "inline_data": { "mime_type": "image/png", "data": "<base64>" } }`. Files API upload also works. [E]
- Images: "Maximum of 6 images per request. Supported formats: PNG, JPEG." [E]
- Max image size: not stated: UNVERIFIED. The general 20 MB inline request cap of the Gemini API is the likely bound. [B]
- Other inputs: audio MP3/WAV up to 180 s; video MP4/MOV up to 120 s; PDF one file, up to 6 pages, 258 tokens per page plus extracted text. [E]
- The reference also lists an `embedContentConfig` with `title`, `taskType`, `autoTruncate`, `outputDimensionality`, `documentOcr`, `audioTrackExtraction`. [AR] The guide's REST example uses top-level `output_dimensionality`. Use the guide shape. Whether `autoTruncate: false` turns truncation into an error is UNVERIFIED.

### One vector per input vs one aggregated vector

- "Adding multiple inputs directly to the `contents` parameter produces one aggregated embedding for all inputs." [E]
- Wrapping each input in its own `Content` "returns separate embeddings for each entry." [E]
- `batchEmbedContents` returns `embeddings[]` "in the same order as provided in the batch request", so N requests give N vectors. [AR]
- So several parts inside one `content` give one fused vector (useful for image + caption). Separate passages must be separate requests.

### Output dimensionality

- Range 128 to 3072. Recommended 768, 1536, 3072. Default 3072. [MP] [E]
- "Gemini Embedding 2 also auto-normalizes truncated dimensions (e.g., 768, 1536)." [E] No client-side L2 normalisation needed. `gemini-embedding-001` still needs it below 3072. [E]

### Task type

- "You cannot use the `task_type` field for the `gemini-embedding-2` model." [E] (The generic reference still lists `taskType`; it applies to `gemini-embedding-001`. [AR])
- Put the instruction in the text instead, for text-only input. [E]

| use | prefix |
|---|---|
| search query | `task: search result \| query: {content}` |
| question answering query | `task: question answering \| query: {content}` |
| fact checking query | `task: fact checking \| query: {content}` |
| code retrieval query | `task: code retrieval \| query: {content}` |
| retrieval document | `title: {title} \| text: {content}` (use `title: none` with no title) |
| classification / clustering | `task: classification \| query: ...`, `task: clustering \| query: ...` on both sides |

Source: [E]. The guide says sentence similarity is not for search. For multimodal input, "The text portion of the multimodal input shouldn't include task type information." [E]

### Token limit

- 8,192 input tokens. [MP]
- "The system silently truncates inputs that exceed this limit." Applies across modalities. [E]

### Price, free tier, usage metadata

Per 1M input tokens. [P]

| | Standard (paid) | Batch (paid) |
|---|---|---|
| text | $0.20 | $0.10 |
| image | $0.45 (~$0.00012/image) | $0.225 (~$0.00006/image) |
| audio | $6.50 | $3.25 |
| video | $12.00 | $6.00 |

- Free tier exists: "Free of charge" on Standard. Batch is not available on the free tier. [P]
- `gemini-embedding-001`: $0.15 standard, $0.075 batch. [P]
- Response: `{ embedding: { values: [...] }, usageMetadata: { promptTokenCount, promptTokenDetails?, ... } }`. `batchEmbedContents` returns `{ embeddings: [...], usageMetadata }`. [AR] Whether `usageMetadata` is always filled for `gemini-embedding-2` is UNVERIFIED; the guide does not show it. [E]

### Rate limits

- No RPM/TPM is published for embedding models on any tier. The page says limits "can be viewed in Google AI Studio". [RL]
- Tier 1 lists "Gemini Embedding" with 500,000 batch enqueued tokens. [RL]

### Data use

- Unpaid: Google uses content "to provide, improve, and develop" its products, and "human reviewers may read, annotate, and process your API input and output." [T]
- Paid: "Google doesn't use your prompts or responses to improve our products" and logs them "for a limited period of time". Paid only "when accessing the API through a Cloud Project associated with an active billing account." [T] [P]

### Check against earlier notes

Earlier notes: "no free tier for gemini-embedding-2; no task_type; MRL 128-3072, 768 recommended and auto-normalised; 8,192 tokens with silent truncation; images max 6 per request PNG/JPEG; $0.10/M text, $0.225/M image tokens; Batch 50%".

| claim | status |
|---|---|
| no free tier | **Wrong.** Free of charge on Standard; Batch is paid only. [P] Irrelevant for Spark: ADR-0005 forbids free-tier use. |
| $0.10/M text, $0.225/M image | **Wrong for standard calls.** Those are Batch prices. Standard is $0.20 text, $0.45 image. [P] |
| Batch 50% | Correct. [P] [E] |
| no task_type | Correct. [E] |
| 128-3072, 768 recommended, auto-normalised | Correct (1536 and 3072 also recommended). [E] [MP] |
| 8,192 tokens, silent truncation | Correct. [E] [MP] |
| 6 images, PNG/JPEG | Correct. [E] |

## 2. pgvector

Source: [PG] https://github.com/pgvector/pgvector (README, master)

- Latest release v0.8.7 (install instructions clone `--branch v0.8.7`). [PG]
- `halfvec`: up to 16,000 dimensions. Storage `2 * dimensions + 8` bytes (768 dims = 1,544 bytes). Operators `<->` L2, `<#>` negative inner product, `<=>` cosine distance, `<+>` L1, all since 0.7.0. [PG]
- Exact search is the default with no index: "By default, pgvector performs exact nearest neighbor search, which provides perfect recall." The halfvec operators work without an index. [PG]
- HNSW max dims: `vector` 2,000, `halfvec` 4,000. Opclass naming: "Use `halfvec_l2_ops` for `halfvec` ... (and similar with the other distance functions)", so cosine is `halfvec_cosine_ops`. The README never spells that name: UNVERIFIED by name, implied by pattern. [PG]
- Index-only half precision: `CREATE INDEX ON items USING hnsw ((embedding::halfvec(3)) halfvec_l2_ops);` and query with the same cast. [PG]

### Filtering

- "A good place to start is creating an index on the filter column. This can provide fast, exact nearest neighbor search in many cases." [PG]
- "Exact indexes work well for conditions that match a low percentage of rows. Otherwise, approximate indexes can work better." [PG]
- Post-filtering loss: "With approximate indexes, filtering is applied *after* the index is scanned. If a condition matches 10% of rows, with HNSW and the default `hnsw.ef_search` of 40, only 4 rows will match on average." [PG]
- Iterative scans, since 0.8.0: `SET hnsw.iterative_scan = strict_order` (exact distance order) or `relaxed_order` (slightly out of order, better recall; re-sort with a materialized CTE, `ORDER BY distance + 0` on Postgres 17+). Stops at `hnsw.max_scan_tuples` (default 20,000, approximate, does not affect the initial scan). `hnsw.scan_mem_multiplier` caps memory as a multiple of `work_mem` (default 1). [PG]
- Few distinct filter values: partial indexes. Many values: partitioning. [PG]
- Multitenancy: "sharing an approximate index between tenants means vectors from one tenant can affect recall (and speed) for other tenants." For isolation use list partitioning or separate tables. [PG]

### Exact search performance

- "To speed up queries without an index, increase `max_parallel_workers_per_gather`." [PG]
- "If vectors are normalized to length 1 ..., use inner product for best performance" (`ORDER BY embedding <#> $1 LIMIT k`). [PG]
- Index use needs `ORDER BY distance LIMIT k`. [PG]
- The README does not state a per-tenant size below which exact scan is recommended. Its "low percentage of rows" line is the closest guidance. [PG]

### Neon

- Neon lists pgvector 0.8.0 for Postgres 14 to 17 and 0.8.6 for Postgres 18. https://neon.com/docs/extensions/pg-extensions
- `halfvec` is supported; up to 4,000 dims for HNSW and IVFFlat. `hnsw.ef_search` defaults to 40. For filters it suggests partial indexes or partitioning. It does not mention iterative scans. https://neon.com/docs/extensions/pgvector
- Neon on Postgres 14 to 17 has 0.8.0, which already has iterative scans. Postgres 18 gets 0.8.6, one patch release behind 0.8.7.

## What this means for Spark (#8)

- Pin `gemini-embedding-2` (stable) from a billed Cloud project only. Use `batchEmbedContents` with one request per passage, so each passage gets its own vector. Use the async Batch API for backfills: half price.
- Store `halfvec(768)` with `output_dimensionality: 768`. The API normalises 768, so skip client-side normalisation. Add a cheap norm check in tests, and rank with `<#>` (or `<=>`, same order for unit vectors).
- Prefixes: queries `task: search result | query: {text}`; passages `title: {Memory title or "none"} | text: {passage}`. No prefix on the text of image+text inputs.
- Passages: about 2,000 characters (about 500 tokens at ~4 chars per token) with a small overlap. That keeps one idea per vector for vague recall, and stays far under 8,192 tokens even for text that tokenises at 2 chars per token. Never send one input over ~24,000 characters: past 8,192 tokens the API truncates silently.
- At ~1k Memories per user (a few thousand passages, ~1.5 KB each at 768 halfvec), use exact scan: `WHERE user_id = $1 ORDER BY embedding <#> $2 LIMIT k` with a btree on `user_id`. It has perfect recall. A shared HNSW index post-filters: with `ef_search` 40, a user owning 0.1% of rows gets almost nothing back unless iterative scans are on. Revisit HNSW with `iterative_scan` or partitioning only if evals or latency say so.
- Query cost: 1,000 queries x ~12 tokens = 12,000 tokens x $0.20/M = **$0.0024** per 1,000 queries at standard price. Price does not depend on dimension. Real tokens include the ~6-token prefix, so budget about $0.004.
- Image cost: $0.45/M standard; the guide does not give tokens per image, but pricing says ~$0.00012 per image. [P]
