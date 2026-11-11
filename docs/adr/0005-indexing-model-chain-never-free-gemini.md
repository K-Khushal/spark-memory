# Indexing uses a paid or zero-retention model chain, never Gemini's free tier

Indexing makes one structured-output call per Memory: Gemma 4 on Cloudflare Workers AI first (free daily allowance, zero data retention), then Gemini Flash-Lite on the paid tier for overflow, scanned PDFs, YouTube links and invalid outputs. Gemini's free tier (including Gemma on the Gemini API) is never used for real users' data: Google trains on it, human reviewers can read it, and it can't serve EEA, UK or Swiss users. Model IDs live in config because Gemini models are being retired and repriced quickly.

## Model ids (November 2026)

Gemma 4 is `@cf/google/gemma-4-26b-a4b-it`; Flash-Lite is `gemini-3.5-flash-lite` on the Standard paid tier. Both, with their prices and the daily AI budget, live in `packages/core/lib/indexing.ts`; the sources are in `docs/research/indexing-providers.md`. The API cannot tell a free-tier key from a paid one, so the Worker calls Gemini only when `GEMINI_PAID_TIER` is `"true"`, set by hand once the key's Cloud project has billing on.
