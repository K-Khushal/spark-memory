# Indexing uses a paid or zero-retention model chain, never Gemini's free tier

Indexing makes one structured-output call per Memory: Gemma 4 on Cloudflare Workers AI first (free daily allowance, zero data retention), then Gemini Flash-Lite on the paid tier for overflow, scanned PDFs, YouTube links and invalid outputs. Gemini's free tier (including Gemma on the Gemini API) is never used for real users' data: Google trains on it, human reviewers can read it, and it can't serve EEA, UK or Swiss users. Model IDs live in config because Gemini models are being retired and repriced quickly.
