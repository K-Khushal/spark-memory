# Search stack research: "save anything, find it later"

Researched 2026-11-10. Prices and limits change often, so re-check the linked page before you commit to one.
Confidence: **[P]** = read on the vendor's own page or paper. **[S]** = secondary/aggregator source only, verify before relying on it.

---

## TL;DR recommendation

| Layer | v1 pick (~$0) | Why |
|---|---|---|
| Embeddings (one space for text + images + PDF pages + video) | **Gemini Embedding 2** (`gemini-embedding-2`), MRL-truncated to **768 dims** | Natively multimodal, stable, one vector space, has a free tier, and paid is $0.20/M text tokens and ~$0.00012 per image [P] |
| Enrichment (caption + OCR + category + tags + dates, one call per item) | **Gemini 2.5 Flash-Lite**, JSON output. On mobile, run OCR on-device (ML Kit / Apple Vision) for free | $0.10/M input and $0.40/M output, with a free tier [P]. Roughly $0.0003 per image |
| Store: metadata + keyword + vector + filters in **one SQL query** | **Supabase Postgres**: `pgvector` (`halfvec(768)`) + `tsvector` + `pg_trgm`, with an RRF SQL function | Easiest single-query hybrid. Auth, RLS and storage are included. Free tier is 500 MB [P] |
| Blobs (images, PDFs, thumbnails) | **Cloudflare R2** (10 GB free, zero egress), or Supabase Storage (1 GB free) to start | Keeps the DB small |
| Rerank | v1: none, or Workers AI `bge-reranker-base` ($0.003/M) / Voyage `rerank-2.5-lite` (200M tokens free) | The per-user corpus is small, so RRF alone is decent |
| Query understanding | Rules + `chrono-node` for dates. A Flash-Lite JSON call runs only for long natural-language queries | Keeps search-as-you-type instant |

Key design trick: **every search is scoped to one user's ~1k items**, so skip ANN indexes (HNSW). Filter on `user_id` with a btree index and do an **exact** vector scan over about 1k rows. It takes a few ms, recall is 100%, the index costs no RAM, and filters can't cause the post-filtering recall loss.

---

## 1. Foundational papers (what matters for an app builder)

| Work | 2–4 line summary → practical takeaway |
|---|---|
| **CLIP** (Radford et al., 2021) [arXiv:2103.00020](https://arxiv.org/abs/2103.00020) | A contrastive image–text dual encoder trained on 400M pairs, which puts images and short texts in one space. It is the origin of "type words, find pictures" and zero-shot labels. **Takeaway:** good for "red sneaker", weak on long text, OCR-heavy screenshots and documents. Its text tower only takes about 77 tokens. |
| **SigLIP** (Zhai et al., 2023) [arXiv:2303.15343](https://arxiv.org/abs/2303.15343) / **SigLIP 2** (Tschannen et al., 2025) [arXiv:2502.14786](https://arxiv.org/abs/2502.14786) | Replaces CLIP's softmax loss with a pairwise sigmoid loss, which is cheaper and better at small batch sizes. SigLIP 2 adds captioning/self-distillation, dense features, multilingual data and NaFlex variable resolution. **Takeaway:** the best *open, Apache-2.0* image encoder ([HF card](https://huggingface.co/google/siglip2-base-patch16-224)). Many 2026 multimodal embedders use it as their vision tower, jina-v5-omni for example. It is still a short-text model. |
| **ColPali** (Faysse et al., 2024) [arXiv:2407.01449](https://arxiv.org/abs/2407.01449) | Embeds *page images* with a VLM (PaliGemma) and keeps one vector per patch, ColBERT-style late interaction (MaxSim). It beats OCR→text pipelines on visually rich documents. **Takeaway:** best quality for PDFs and slides, but you store ~1k vectors per page and need MaxSim support. That is overkill for v1. Use a single-vector "page image" embedding plus OCR text instead. |
| **jina-embeddings-v4** (Günther et al., 2025) [arXiv:2506.18902](https://arxiv.org/abs/2506.18902) | A 3.8B model on Qwen2.5-VL-3B. Text and images share one space, with single-vector (2048-d, MRL down to 128) or multi-vector (128-d per token) output, and 32K context [P, [model page](https://jina.ai/models/jina-embeddings-v4/)]. **Takeaway:** one model can do both dense and late-interaction retrieval. The weights are **non-commercial** (Qwen Research License), so use it only through the API. |
| **Gemini Embedding** (Lee et al., 2025) [arXiv:2503.07891](https://arxiv.org/abs/2503.07891) → **Gemini Embedding 2** [arXiv:2605.27295](https://arxiv.org/abs/2605.27295) | v1 initialises a text embedder from Gemini, trained with LLM-curated hard negatives. It was #1 on MMTEB multilingual. v2 (2026) is *natively multimodal*: text, image, video, audio and PDF go into one 3072-d space with MRL. **Takeaway:** the managed one-space option for this app. |
| **Matryoshka Representation Learning** (Kusupati et al., 2022) [arXiv:2205.13147](https://arxiv.org/abs/2205.13147) | Trains embeddings so that any prefix (e.g. the first 256 or 768 dims) is itself a good embedding. **Takeaway:** store 768-d (or 512-d) cuts of a 3072-d model and lose little quality, at 4–6× less storage. You can also do a fast 256-d first pass and re-score at full dims. |
| **BM25 + dense hybrid, RRF** (Cormack, Clarke & Büttcher, SIGIR 2009, [paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf); BEIR, [arXiv:2104.08663](https://arxiv.org/abs/2104.08663)) | BEIR showed BM25 is a robust zero-shot baseline and dense models often lose out-of-domain. RRF fuses ranked lists with `score = Σ 1/(k + rank)` (k≈60) and needs no score calibration. **Takeaway:** always run keyword and vector together and fuse with RRF. Keyword catches exact names, receipt numbers and OCR strings. Vector catches meaning. |
| **VLM2Vec** (Jiang et al., 2024) [arXiv:2410.05160](https://arxiv.org/abs/2410.05160); **VLM2Vec-V2** [arXiv:2507.04590](https://arxiv.org/abs/2507.04590) | Turns a VLM into a universal embedder with instruction-conditioned contrastive training, and introduced the MMEB benchmark (v2 adds video and visual documents). **Takeaway:** "universal" embedders now come from VLM backbones. When choosing a model, look at MMEB scores. |
| **GME** (Zhang et al., 2024) [arXiv:2412.16855](https://arxiv.org/abs/2412.16855) | A Qwen2-VL-based General Multimodal Embedder that handles any mix of text, image and fused inputs, trained with synthetic fused-modal data. **Takeaway:** fused inputs (image + caption in *one* vector) retrieve better than either alone. Embed "screenshot + title + OCR" together. |
| **Qwen3-VL-Embedding / Reranker** (2026) [arXiv:2601.04720](https://arxiv.org/abs/2601.04720) | Open 2B/8B unified multimodal embedder and reranker for text, image and video. Cloudflare AI Search offers `@cf/qwen/qwen3-vl-embedding-2b` (1024-d, 32K tokens, images) [P, [CF models](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/)]. **Takeaway:** the best self-hostable "one space" option. One mirror lists it as Apache-2.0 [S], so verify on HF. |
| **Nomic Embed Multimodal / ColNomic** (2025) [blog](https://nomic.ai/news/nomic-embed-multimodal) | 3B/7B VLM embedders for interleaved text and page images, in dense and Col (multi-vector) variants. The 3B dense is reported as Apache-2.0 [S]. **Takeaway:** a strong open visual-document retriever. Its hosted API pricing is not public [S]. |
| **Voyage multimodal-3 / 3.5** [docs](https://docs.voyageai.com/docs/multimodal-embeddings) | A single transformer over *interleaved* text and image (and video in 3.5) rather than CLIP-style separate towers, so it handles screenshots with text well. **Takeaway:** a strong managed alternative to Gemini, with a generous free grant. |
| **Cohere Embed v4 → Embed 5** (Apr 2025 / Oct 2026) [cohere.com/embed](https://cohere.com/embed) | Multimodal (text + image + mixed documents), 128K context, compressed output. Embed 5 Pro/Fast share one space [S]. **Takeaway:** an enterprise-grade option, but there is no free *commercial* tier. Trial keys are non-production [P]. |
| **jina-embeddings-v5-omni** (May 2026) [model page](https://jina.ai/models/jina-embeddings-v5-omni-small/) | 1.7B: Qwen3-0.6B text plus a SigLIP2-L vision tower and a Whisper audio tower, 1024-d with MRL down to 32, 32K tokens. It is aligned with v5-text, so text indexes need no re-embedding. **Takeaway:** a nice architecture, but the weights are CC-BY-NC [P]. API only. |

---

## 2. One embedding space for text + images: options

| Model / API | Image native? | Dims (MRL) | Max input | Price (paid) | Free | License / self-host |
|---|---|---|---|---|---|---|
| **Gemini Embedding 2** `gemini-embedding-2` (stable) | Yes: text, image (≤6/req, PNG/JPEG), PDF (≤6 pages), audio ≤180 s, video ≤120 s | 128–3072, default 3072; 768/1536/3072 recommended | 8,192 tokens total | Text $0.20/M; image $0.45/M (~$0.00012/img); batch is 50% off [P] | Free tier (rate limits shown in AI Studio). **Free-tier data "used to improve our products": Yes**, paid: No [P] | API only |
| Gemini Embedding 001 | No (text) | 128–3072 | 2,048 | $0.15/M | Free tier | API |
| **Voyage multimodal-3.5** | Yes: interleaved text + images + video | 256/512/**1024**/2048 | 32K tokens; images ≤16 MP | $0.12/M text + $0.60/B pixels (~$0.00003–$0.0012/img) [P] | **First 200M tokens + 150B pixels free**, one-time per account [P] | API only |
| **Cohere Embed v4 / Embed 5** | Yes | v4 1536 (Matryoshka), Embed 5 2048 [S] | 128K | v4 ~ $0.12/M text, ~$0.47/M image [S]; Embed 5 Pro $0.12 / Fast $0.08 text, $0.40/M image [S] | Trial: 1,000 calls/month, 5 images/min, **no production or commercial use** [P, [rate limits](https://docs.cohere.com/docs/rate-limits)] | API (also Bedrock/Azure/OCI) |
| **Jina v4 / v5-omni (API)** | Yes | v4 2048 (→128); v5-omni 1024 (→32) | 32K | ~$0.05/M tokens [S] (no official page found) | 10M free tokens per new key [S] | Weights **non-commercial** (Qwen RL / CC-BY-NC) [P] |
| **Cloudflare Workers AI** text embedders: `bge-m3`, `qwen3-embedding-0.6b`, `embeddinggemma-300m`, `bge-*-en` | **No** (text only) [P] | 384–1024 | 512–8,192 | bge-m3 / qwen3-0.6b $0.012/M; bge-base $0.067/M [P] | 10,000 neurons/day free (~9M tokens/day of bge-m3) [P] | Open models |
| Cloudflare **AI Search** with `@cf/qwen/qwen3-vl-embedding-2b` or `gemini-embedding-2` | Yes (managed pipeline) [P] | 1024 / 1536 | 32,768 / 8,192 | Ingest $0.75/M tokens + $0.50/M for images; **$0.75 per 1k semantic queries** [P, [GA post](https://blog.cloudflare.com/ai-search-ga/)] | 5M tokens, 1k semantic + 1k full-text queries/month, 10 GB | Managed. A standalone Workers AI page for qwen3-vl-embedding returned 404, so it is likely only usable inside AI Search |
| **Nomic** embed-vision-v1.5 / embed-multimodal-3B | Yes | 768 / ~2048 | — | Atlas API price is "contact sales" [S] | — | v1.5 and multimodal-3B open (Apache-2.0 [S]) |
| **SigLIP 2** (self-host) | Yes (dual tower) | 768 (base) – 1152 (so400m) | ~64 text tokens | $0 compute if run in the browser (ONNX/transformers.js export, community [S]) or on a free CPU Space | — | **Apache-2.0** [P, [HF](https://huggingface.co/google/siglip2-base-patch16-224)] |
| **Qwen3-VL-Embedding-2B** (self-host) | Yes | up to 2048 (MRL) | 32K | Needs a GPU (~5 GB VRAM). Not truly free infra | — | Apache-2.0 [S], verify |

### Alternative pattern: caption the image with a cheap VLM, embed only the caption text

| Pros | Cons |
|---|---|
| One cheap text embedder (Workers AI bge-m3 at $0.012/M) and one vector type | Loses whatever the caption omits: exact shade, style, layout, "looks like this" |
| Caption and OCR text also feed **keyword search**, display, categorisation and LLM answers | **Image-as-query** needs a VLM call to caption the query photo (~1–2 s latency, extra cost) |
| Easy to debug: you can read *why* something matched | Quality depends on the caption prompt; re-captioning means re-processing everything |
| Swapping embedding models later only re-embeds text | Weak for "find visually similar" (Lens-style) |

**Verdict:** do both. You need the VLM call anyway (OCR, category, tags, dates for filters). Store that text for keyword search, *and* embed the image pixels plus the caption/OCR with a native multimodal model. Gemini Embedding 2 combines multiple `parts` into one embedding [P], which is the GME "fused input" idea. If you must be text-only (e.g. a 100% Cloudflare stack), caption-then-embed is acceptable for v1. Lens-style similarity is what suffers.

---

## 3. Vector + keyword storage on free tiers

| Service | Free tier (verified 2026-11) | Vector | Keyword / BM25 | Hybrid in one query? |
|---|---|---|---|---|
| **Supabase** (Postgres) | 500 MB DB/project, 1 GB files, 5 GB egress, 50k MAU, 2 projects, **pauses after 1 week inactive**. Pro is $25/mo for 8 GB disk [P, [pricing](https://supabase.com/pricing)] | pgvector (vector, halfvec, bit; HNSW/IVF) | `tsvector` + GIN, `pg_trgm` for typos. **No native pg_search**: ParadeDB only as a separate logical replica [P, [partner page](https://supabase.com/partners/integrations/paradedb)] | **Yes.** Their documented `hybrid_search()` SQL function does FTS + vector + RRF (`rrf_k=50`, weights) in one call [P, [guide](https://supabase.com/docs/guides/ai/hybrid-search)]. Add `WHERE` filters for type, date and source |
| **Neon** (Postgres) | 1 GB/project (20 GB total across 100 projects), 100 CU-h/project/month, scale-to-zero, no pausing for inactivity. Paid storage is $0.35/GB-mo [P, [pricing](https://neon.com/pricing)] | pgvector | tsvector. **pg_search was retired from Neon on 2026-09-21**; replacement is `lakebase_text` [P, [docs](https://neon.com/docs/extensions/pg_search)] | Yes, same SQL as Supabase |
| **Cloudflare Vectorize** | Free: **5M stored dims** (≈6.5k vectors at 768-d!) and 30M queried dims/month. Paid ($5 Workers plan): 10M stored + 50M queried included, then $0.05/100M stored and $0.01/M queried. Queried = (queries + stored vectors) × dims [P, [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)] | ≤1536 dims, 20M vectors/index, 10 metadata indexes, topK 50 with metadata, 1k (free) / 50k namespaces [P, [limits](https://developers.cloudflare.com/vectorize/platform/limits/)] | None. Pair with D1 (SQLite FTS5) | **No.** Two calls plus RRF in Worker code |
| **Turso** (libSQL) | 100 DBs, **5 GB**, 500M rows read / 10M written per month. Developer tier $4.99 [P, [pricing](https://turso.tech/pricing)] | Native `F32/F16/F8/F1BIT_BLOB`, ≤65,536 dims, DiskANN index, `vector_top_k()`, partial-index filters [P, [docs](https://docs.turso.tech/features/ai-and-embeddings)] | Tantivy-based FTS (`fts_match`/`fts_score`) in the new Turso DB [P, [docs](https://docs.turso.tech/sql-reference/functions/fts)]; Turso Cloud availability unclear | Possible in SQL, but less mature, and you write RRF by hand. Most generous free storage |
| **Qdrant Cloud** | 1 node: 0.5 vCPU, 1 GB RAM, 4 GB disk (~1M 768-d vectors). **Suspended after 1 week idle, deleted after 4 weeks** [P, [docs](https://qdrant.tech/documentation/cloud/create-cluster/)]. Free cloud inference for selected models [P] | Dense + sparse, payload filters | BM25 via sparse vectors | Yes: Query API with prefetch + `fusion: rrf` in one request. But it is a second database next to your app DB |
| **Upstash Vector** | 200M vectors×dims, ≤1536 dims, **10k queries+updates/day**, 1 GB, 10 indexes. Pay-as-you-go $0.40/100k requests [P, [pricing](https://upstash.com/pricing/vector)] | Dense, namespaces, metadata filter | Sparse/BM25 hybrid indexes (per Upstash docs [S]) | Yes, in-index, but again a second store |

**Free capacity per user** (my estimate): one item ≈ 1.5 KB `halfvec(768)` + ~2–4 KB text/tsvector/GIN/trigram/row overhead ≈ **~6 KB in Postgres** with no HNSW. That gives:

- Supabase free (500 MB): ≈ **80k items ≈ 80 users × 1k items**
- Neon free (1 GB): ≈ **160k items**
- Supabase Pro (8 GB): ≈ **1.3M items**
- 5M items: ≈ 30 GB

**Easiest single-query hybrid:** Postgres (Supabase or Neon). App data, ACL (RLS), filters, tsvector, trigram and vectors all live in one transaction and one SQL function. Every other option means syncing a second store.

Sketch (Postgres):

```sql
-- items(user_id uuid, type text, source text, category text, tags text[], created_at timestamptz,
--       title text, body text, ocr text, fts tsvector GENERATED ALWAYS AS (...) STORED, emb halfvec(768))
-- indexes: btree(user_id, created_at), GIN(fts), GIN(title gin_trgm_ops). NO hnsw (per-user exact scan).
WITH f AS (SELECT * FROM items WHERE user_id=$1 AND ($2::text[] IS NULL OR type = ANY($2))
           AND created_at BETWEEN $3 AND $4),
kw AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(fts, q) DESC) r
       FROM f, websearch_to_tsquery('simple',$5) q WHERE fts @@ q LIMIT 50),
vec AS (SELECT id, row_number() OVER (ORDER BY emb <=> $6) r FROM f ORDER BY emb <=> $6 LIMIT 50)
SELECT id, COALESCE(1.0/(60+kw.r),0) + COALESCE(1.0/(60+vec.r),0) AS score
FROM kw FULL JOIN vec USING (id) ORDER BY score DESC LIMIT 30;
```

---

## 4. Search UX and quality techniques

**Query understanding.**
- Parse dates deterministically with `chrono-node` ("last month", "in March"). Handle type keywords ("pdf", "screenshot", "video", "receipt") with a small dictionary. Both are instant and free.
- For longer natural-language queries, call Flash-Lite with a JSON schema: `{semantic_query, keywords[], types[], date_from, date_to, source, category}`. That costs about 400 input and 80 output tokens, ≈ $0.00007/query [P pricing].
- Cloudflare Workers AI `llama-3.1-8b-instruct-fast` is an alternative inside the free neuron budget.
- Use extracted filters as **soft boosts** unless they are explicit. "Last month" should widen to ±2 weeks if there are 0 hits.

**Hybrid + RRF.** Always run keyword and vector. The keyword leg covers OCR text, URLs, domains and tags.

**Reranking** (top 20–30 per query). Options:
- Workers AI `bge-reranker-base`: $0.003/M tokens, 512-token limit [P]. Basically free.
- Voyage `rerank-2.5-lite`: $0.02/M with 200M free [P].
- Jina `jina-reranker-v3` / `v3.5` (text), or **`jina-reranker-m0` (multimodal, ranks images)**. Weights are CC-BY-NC, so use the API [S].
- Cohere Rerank: trial is non-commercial [P].
- Qwen3-VL-Reranker (open, self-host).

Text rerankers only see caption and OCR text, so feed them `title + caption + ocr`. For v1 you can skip reranking: per-user corpora are small and RRF is strong.

**Typo tolerance.**
- `pg_trgm` `word_similarity()` on title, tags and domain. tsvector has no fuzzy matching.
- Embeddings are naturally somewhat typo-robust.
- Client-side: MiniSearch, FlexSearch or Orama with fuzzy and prefix matching.

**Instant search-as-you-type.**
- Per keystroke (debounce ~120 ms), run keyword prefix + trigram only: Postgres `to_tsquery('foo:*')`, or a client-side index of the user's ~1k item titles, tags and OCR snippets (~1 MB, works offline on mobile).
- On pause (~350 ms) or Enter, run the full hybrid (embed query → SQL). The query embedding is one API call (~100–300 ms).
- Optional: cache the user's int8 vectors on the client (1k × 768 B ≈ 0.75 MB) for fully local vector search. Only the query embedding then needs the network.

**Image-as-query.** Embed the uploaded photo with the same model and run the vector leg only. Optionally OCR the query image and add its text to the keyword leg.

**Filters UI.** Show chips for type, source domain, category and date range, pre-filled from query parsing so users can see and remove them.

---

## 5. Recommendation for v1, upgrade path, and costs

### v1 (~$0/month)

**Ingest pipeline** (Supabase Edge Function or Cloudflare Worker + queue):

1. Store the blob in R2 or Supabase Storage. Generate a WebP thumbnail.
2. Links: fetch title, description, og:image and main text (Workers `fetch`, or the Jina Reader API). Social/video links: oEmbed title, author and thumbnail.
3. Enrichment, one Gemini 2.5 Flash-Lite call returning JSON: `caption, ocr_text, category, tags[], entities, detected_dates, dominant_colors`.
   - Mobile: OCR on-device (Android ML Kit, iOS Vision) and send the text, so the VLM call can be smaller or skipped.
   - Web: Tesseract.js is an optional fallback.
4. Embed with `gemini-embedding-2`, `outputDimensionality=768`, as one fused input:
   - visual items: `[image part, "title: … | text: caption + ocr"]`
   - text/link items: `title: {title} | text: {content}`
   - queries: `task: search result | query: {q}` (the prompt prefixes the docs require [P])
   - PDFs: embed page 1 as an image plus text chunks.
   - Use the **Batch API (50% off)** for backfills.
5. Insert into Postgres (`halfvec(768)`, generated `tsvector`, btree on `(user_id, created_at)`).

**Query path:** chrono/rules (plus an LLM for long queries) → embed the query → one `hybrid_search()` SQL call → optional rerank → results.

**Free-tier caveats:**
- **Data use and privacy.** Gemini free-tier inputs may be used to improve Google products [P]. For a personal-memory app, disclose this, or turn on billing early, which is cheap.
- **Pausing.** Supabase pauses a free project after 1 week without activity.
- **Capacity.** The 500 MB DB holds ~80 power users. Pure $0 cannot hold 1–5k users × 1k items (1–5M items ≈ 6–30 GB DB, plus blobs).

### Cost per 1,000 saved items (paid rates)

Assumed mix: 40% links/text, 40% screenshots/images, 15% PDFs, 5% video links.

| Step | Calculation | Cost |
|---|---|---|
| Embeddings (Gemini Embedding 2) | 400 × 800 text tok + 400 images (+ caption tok) + 150 PDFs (page image + 2k tok) + 50 videos (thumb) | **≈ $0.22** (≈ $0.11 with Batch) |
| Enrichment (Flash-Lite) | images ~1.5k in / 300 out ≈ $0.00027 each; PDFs ≈ $0.0004; text ≈ $0.00016 | **≈ $0.24** (≈ $0.13 if text items skip the LLM and OCR runs on-device) |
| DB storage | ~6 KB × 1,000 = 6 MB | ≈ $0.002/month (Neon $0.35/GB) |
| Blob storage (R2, $0.015/GB-mo after 10 GB) | ~0.5 × 1,000 × 220 KB ≈ 110 MB | ≈ $0.002/month |
| **Total** | | **≈ $0.25–0.50 one-time + < $0.01/month** |

Searches: query embedding ≈ $0.003 per 1k searches. Adding LLM query parsing brings it to ≈ $0.07/1k, image queries ≈ $0.12/1k, and a Voyage-lite rerank ≈ $0.18/1k (Workers AI bge ≈ $0.03/1k).

**Scale check.** At 5k users saving 100 items/month each (500k items/month), ingestion is ≈ $60–250/month. That is the dominant cost, not storage.

Levers to cut it:
- Batch embeddings.
- Skip the LLM for plain text and links.
- On-device OCR.
- Use Voyage's one-time free grant (200M tokens + 150B pixels ≈ 150k+ images) to bootstrap.

### Upgrade path

1. **~80+ active users:** Supabase Pro ($25/mo, 8 GB ≈ 1.3M items), or Neon Launch (pay-as-you-go, storage $0.35/GB). Move blobs to R2 if they aren't there yet. Enable Gemini paid billing, which removes the data-use concern and the rate limits.
2. **Quality:** add a reranker (bge-reranker-base → Voyage rerank-2.5 / jina-reranker-m0 for images). Add a second "pixels-only" vector for Lens-style "find visually similar". Add per-page vectors for multi-page PDFs.
3. **Scale (>10M items or global/shared search):** add HNSW (or per-user table partitioning), or move vectors to Qdrant/Vectorize with Postgres kept as the source of truth. Use ParadeDB as a logical replica for real BM25.
4. **Cost or self-hosting:** run Qwen3-VL-Embedding-2B (verify the Apache-2.0 license) or SigLIP 2 on a cheap GPU, with a text embedder alongside it. Re-embed everything (embedding spaces are incompatible across models [P]). Store the model id and dims per row so this can be done incrementally.

**Lock-in hedge:** keep raw text, captions and OCR in the DB. Re-embedding 1M items with Gemini Batch costs roughly $100, so switching models stays affordable.

---

## 6. What is "jev (a model)"?

Ranked likely candidates:

1. **TypeSafe Jev** (most likely, and an exact fit for "categorise content"). It is a general *classification* model launched in mid-September 2026 by TypeSafe (founder Diogo Almeida).
   - It "can answer any question with predefined outputs": yes/no, choose from a list with calibrated confidence, or a 0–10 score.
   - It is transformer-based, non-autoregressive, and **text-only**, with up to 64K tokens of input.
   - Input costs ≈ $0.042/M tokens and output is free [S]. The API is `POST api.typesafe.ai/v1/systemone`, model `jev-1.13` [S]. Early access [S].
   - Vercel and Cloudflare added support [S].
   - Sources: [The Batch](https://www.deeplearning.ai/the-batch/models-built-to-do-one-thing-well), [Raschka](https://sebastianraschka.com/blog/2026/jev-classification-generalization.html), [OpenRouter](https://openrouter.ai/models/typesafe/jev-1.13).
   - **Fit:** cheap, fast categorisation of the *text* we already produce (caption + OCR + title). It can't see images directly.
   - In v1 the Flash-Lite enrichment call already returns a category, so Jev is optional. It is worth it if you want calibrated confidence, many category questions, or to drop the LLM for text items.
   - Imitators: Laya, Bespoke Nimble, Kev [S].
2. **Jina Embeddings v4/v5** ("J-E-v…"). A plausible typo for an *embedding* model. It is used to categorise by nearest category-centroid, not as a classifier. Weights are non-commercial.
3. **V-JEPA 2** (Meta, June 2025). A self-supervised *video* world model that is open for commercial use. "jepa" can sound like "jev". It is unlikely to be the intended model, because it is a video-understanding backbone, not a content categoriser.
4. **I-JEPA / JEPA family**: image representation learning. Same reasoning as V-JEPA 2.

→ Confirm with the user. Most likely they mean **TypeSafe Jev**.

---

## Sources

**Embeddings and models**
- Gemini: [pricing](https://aistudio.google.com/docs/pricing), [embeddings docs](https://aistudio.google.com/docs/embeddings), [Gemini Embedding 2 report](https://arxiv.org/abs/2605.27295)
- [Voyage pricing](https://docs.voyageai.com/docs/pricing), [Voyage multimodal docs](https://docs.voyageai.com/docs/multimodal-embeddings)
- Jina: [v4](https://jina.ai/models/jina-embeddings-v4/), [v5-omni](https://jina.ai/models/jina-embeddings-v5-omni-small/), [reranker-m0](https://jina.ai/models/jina-reranker-m0/)
- Cohere: [pricing](https://cohere.com/pricing), [rate limits](https://docs.cohere.com/docs/rate-limits), [Embed 5 pricing (secondary)](https://www.eesel.ai/blog/cohere-embed-5-pricing)
- [Nomic Embed Multimodal](https://nomic.ai/news/nomic-embed-multimodal)
- [Qwen3-VL-Embedding paper](https://arxiv.org/abs/2601.04720)
- [SigLIP 2 model card](https://huggingface.co/google/siglip2-base-patch16-224)

**Cloudflare**
- Workers AI: [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [models](https://developers.cloudflare.com/workers-ai/models/), [toMarkdown](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)
- AI Search: [GA post](https://blog.cloudflare.com/ai-search-ga/), [supported models](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/)
- Vectorize: [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), [limits](https://developers.cloudflare.com/vectorize/platform/limits/)

**Storage**
- Supabase: [pricing](https://supabase.com/pricing), [hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [ParadeDB partner page](https://supabase.com/partners/integrations/paradedb)
- Neon: [pricing](https://neon.com/pricing), [pg_search retirement](https://neon.com/docs/extensions/pg_search)
- Turso: [pricing](https://turso.tech/pricing), [vectors](https://docs.turso.tech/features/ai-and-embeddings), [FTS](https://docs.turso.tech/sql-reference/functions/fts)
- Qdrant: [pricing](https://qdrant.tech/pricing/), [free cluster](https://qdrant.tech/documentation/cloud/create-cluster/)
- [Upstash Vector pricing](https://upstash.com/pricing/vector)

**Jev and V-JEPA 2**
- Jev: [The Batch](https://www.deeplearning.ai/the-batch/models-built-to-do-one-thing-well), [Raschka](https://sebastianraschka.com/blog/2026/jev-classification-generalization.html), [OpenRouter listing](https://openrouter.ai/models/typesafe/jev-1.13)
- V-JEPA 2: [coverage](https://wandb.ai/byyoung3/ml-news/reports/Meta-Unveils-V-JEPA-2-A-World-Model-for-Physical-Understanding-Prediction-and-Robot-Planning--VmlldzoxMzE4Mjc2Mw)

**Papers:** see the arXiv links in section 1.
