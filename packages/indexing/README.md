# @spark/indexing

Indexing providers behind one interface: extraction (Gemma 4 → Gemini), categorisation (Jev), colours, embeddings and the fallback chain (ADR-0005, ADR-0008). Deep fetch (ADR-0010) is `@spark/deep-fetch`; it reuses this package's public-fetch guard and page reader.

Entry point: `index.ts`. Implementation goes in `lib/`, tests in `tests/` (see [packages/README.md](../README.md)).
