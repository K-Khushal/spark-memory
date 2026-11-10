# Cloudflare Workers for compute, Neon Postgres for data and search

The API and the web app run in one Cloudflare Worker (Hono), with Queues for background Indexing, R2 for files (no egress fees) and Workers AI for the free first pass of Indexing. All data and both search indexes live in Neon Postgres (pgvector, full-text search and pg_trgm), reached through Hyperdrive and accessed only through Drizzle, so the database host can be swapped later.

## Considered Options

- **Cloudflare D1 + Vectorize:** the free vector store holds only about 6.5k vectors at 768 dimensions, which is a few users' worth. Keyword, vector and filter search would also have to be merged in application code instead of in one query.
- **Supabase (Postgres, Auth, Storage, Edge Functions):** an all-in-one option, but free projects pause after 7 idle days, storage is only 1 GB, and its server functions run on Deno rather than the monorepo's Node/Workers toolchain.

## Consequences

- The Workers free plan allows 10 ms of CPU per request. Heavy parsing (page text extraction, password hashing) must not run in the Worker. See ADR-0006 and ADR-0007.
- The first fixed bill is Workers Paid ($5/month), which lifts the CPU, Queues and request ceilings together.
