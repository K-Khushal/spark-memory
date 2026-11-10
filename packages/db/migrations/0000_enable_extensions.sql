-- Search needs pgvector (halfvec embeddings) and pg_trgm (fuzzy keyword match). ADR-0004.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
