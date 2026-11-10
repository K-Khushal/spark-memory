# Multi-vector hybrid search in one Postgres query

Each Memory has several Gemini Embedding 2 vectors in one shared text-and-image space:

- **Overview**: one vector from title, description, Tags and Capture note.
- **Visual**: one per image, screenshot, PDF page or video keyframe.
- **Passage**: one per ~400-token chunk of readable text, OCR text or transcript. Transcript passages keep their timestamps.

One SQL function compares the query (text or image) against all of them and scores each Memory by its best-matching vector. It combines that with keyword rank (tsvector), typo-tolerant trigram matching and filters, merges the rankings with Reciprocal Rank Fusion, and reports which part matched. Searches are always scoped to one user's Library, so the vector side is an exact scan filtered by user instead of an approximate index.

## Considered Options

- **One vector per Memory** (the first version of this ADR): cheaper, but one vector blurs long articles, PDFs and transcripts into mush, and it can't say which passage or moment matched.

## Consequences

- Vector size (768, 1536 or 3072), passage length and reranker are chosen by the search test set, not by guesswork. The model ID and dimension are stored with every vector so re-embedding is a background job.
- Add an HNSW index only when a single Library grows past roughly 50k vectors.
