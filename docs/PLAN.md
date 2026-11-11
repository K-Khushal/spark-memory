# Spark: web phase implementation plan

Spark is a personal memory library: **save anything, find it by describing what you vaguely remember.** This plan covers the web phase (dashboard, browser extension, Android PWA share target, MCP server for Connected assistants) and sets up the monorepo that the Android and iOS apps will join later.

- Vocabulary: [GLOSSARY.md](../GLOSSARY.md). Every ticket, type and UI string uses these words.
- Decisions and why: [docs/adr/](./adr/) (ADR-0001 … 0011).
- Research behind them: [docs/research/](./research/) (`stack.md`, `search.md`, `enrichment.md`).
- Product intent: [PRD.md](./PRD.md), a rough draft. Where this plan and the PRD differ, this plan wins.

## 1. The three things that matter

1. **Effortless Capture**: paste or drop anywhere in the dashboard, one click or shortcut in the extension, the Android share sheet via the PWA, and imports from other tools.
2. **Indexing every Memory**: one-time, paid by Spark, cheap. Describe what it shows, read the text in it, pick its Categories, extract colours, and place it in the search space.
3. **Search that works from vague memory**: meaning, appearance, colour, text inside images, typos, dates. Direct matches first, Related matches clearly apart, search by image, and a jump straight to the moment or passage that matched.

Plus **UI/UX as the differentiator** (section 7), and **AX/DX** good enough that agents can build most of it (section 8).

**Not building**: chat, summaries or any generative answer (ADR-0001), folders, end-to-end encryption (ADR-0011), server-side logins to social platforms (ADR-0010).

## 2. Stack

| Layer                           | Choice                                                                                                                          | ADR        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Monorepo                        | pnpm workspaces + Turborepo                                                                                                     | 0002       |
| Web dashboard                   | Vite + React 19 + TanStack Router (SPA), Tailwind v4, shadcn/ui restyled from `DESIGN.md`, Motion, cmdk, Sonner                 | 0002       |
| API                             | Hono on one Cloudflare Worker, which also serves the web build; typed `hc` client; Zod                                          | 0003       |
| Data + search                   | Neon Postgres (Singapore) with pgvector, tsvector and pg_trgm, via Hyperdrive; Drizzle. Separate **dev** and **prod** databases | 0003, 0004 |
| Files                           | Cloudflare R2, with presigned direct uploads from the client                                                                    | 0003       |
| Jobs                            | Cloudflare Queues (priority: fresh Captures > Deep fetch > imports/re-index)                                                    | 0003       |
| Extraction                      | Gemma 4 on Workers AI → Gemini Flash-Lite (paid tier)                                                                           | 0005       |
| Categories + Direct-match judge | Jev (TypeSafe)                                                                                                                  | 0008       |
| Embeddings                      | Gemini Embedding 2, several vectors per Memory                                                                                  | 0004       |
| Deep fetch                      | Cloudflare Browser Rendering + a Cloud Run fetcher container (yt-dlp, ffmpeg, headless browser)                                 | 0010       |
| Auth                            | Better Auth: Google, GitHub, email one-time code (Resend); Turnstile on sign-up                                                 | 0007       |
| Extension                       | WXT (Chrome, Edge, Firefox; Safari later)                                                                                       | 0006       |
| Mobile (later)                  | Expo + expo-share-intent; reuses design tokens, not components                                                                  | 0002       |
| Ops                             | Sentry (content scrubbed), Workers Logs, PostHog (no Memory content), free uptime monitor                                       | n/a        |
| Tests                           | Vitest, Postgres+pgvector in Docker / CI service, Playwright smoke tests, the search test set                                   | n/a        |

**Where money starts**: Gemini paid tier from the first real user (cents a month). Workers Paid at $5/month when the 10 ms CPU, Queues or Browser Rendering limits bite. A paid Neon plan when total data passes the free storage. Domain `sparkmemory.xyz` at launch. Chrome Web Store has a $5 one-time fee. Supermemory is never on the bill: its free credits are used only as a search benchmark (ADR-0009).

## 3. Monorepo layout

```
apps/
  server/       Cloudflare Worker: Hono API, Queue consumers, serves the web build
  web/          Vite SPA dashboard, also the PWA and Android share target
  extension/    WXT browser extension
  fetcher/      Cloud Run container for Deep fetch (yt-dlp, ffmpeg, headless browser)
  mobile/       (later) Expo app with share extensions
packages/
  core/         domain types, Zod schemas, URL normalising, Free allowance config; no runtime deps
  db/           Drizzle schema, migrations, the hybrid search SQL function
  api-client/   typed Hono client used by web, extension and mobile
  auth/         Better Auth server config and client helpers
  indexing/     extraction, categorisation, colour, embedding providers and the fallback chain
  search/       query parsing, hybrid search, the Direct/Related split, why-chips
  capture/      client-side extraction shared by web and extension (Defuddle, thumbnails, HEIC)
  ui/           design tokens and web React components (dashboard and extension popup)
  config/       tsconfig, eslint, tailwind presets
evals/          search test set: sample Library, vague searches, scorer, Supermemory baseline
```

Each package exposes only its entry point; dependency-cruiser enforces this (`setup-ts-deep-modules`).

## 4. Data model (first cut)

- **Better Auth tables**: user, session, account, verification, plus OAuth provider tables and personal access tokens for MCP.
- **memory**: id, user_id, kind (`text | image | link | social_post | video | pdf | file`), source_url, source_url_normalised, source_anchor (text fragment, timestamp or page), content_hash, title, body (text Memories), capture_note, capture_client, preservation (`preserved | reference_only`), index_state (`indexing | searchable | failed`), index_error, ai_opt_out, categories_locked, deep_fetch_state, language, metadata (jsonb), captured_at, last_saved_at.
  - Unique on (user_id, source_url_normalised) and (user_id, content_hash): saving the same thing twice resurfaces the existing Memory.
- **memory_file**: memory_id, role (`original | screenshot | thumbnail | readable_text | page_image`), r2_key, mime, bytes, width, height, thumbhash.
- **memory_index**: memory_id, description, ocr_text, transcript (jsonb segments with timestamps), entities (jsonb), tags (text[]), colours (dominant palette, as Lab + names), search_tsv (weighted tsvector, language-aware), indexing_model, index_version, indexed_at.
- **memory_vector**: memory_id, user_id, kind (`overview | visual | passage`), anchor (page, timestamp or character range), embedding halfvec(N), embedding_model.
- **category**: id, user_id (null for built-in), name, description. **memory_category**: memory_id, category_id, probability, assigned_by (`ai | user`).
- **search_event**: user_id, query, result clicked and its position, reformulated (bool), at. Recent searches and the PRD's success metrics come from here.
- **assistant_activity**: user_id, client, tool, query or memory_id, at. Drives the Connected assistant activity log.
- **usage_day**: user_id, day, captures, bytes_added, deep_fetches, ai_cost_micros. **spend_day**: day, provider, cost_micros (the global budget breaker).

## 5. Capture → Indexing pipeline

1. **Client** (dashboard, extension, PWA, importer) builds the Capture:
   - text, file or URL, plus whatever it can extract itself: readable text (Defuddle), visible or region screenshot, og/JSON-LD metadata, the text-fragment link of a selection, the YouTube timestamp;
   - thumbnails, thumbhash and HEIC→JPEG conversion done in the browser.

   Files go straight to R2 through a presigned URL. The Memory shows up instantly with a "Saved" toast and Undo. An offline outbox retries later.

2. **API**:
   - normalises the URL and hashes the content; a duplicate bumps `last_saved_at` and answers "Already in your Library";
   - checks the Free allowance: over-limit links become Reference only, over-limit files are refused with a reason;
   - writes the Memory (`indexing`, keyword-searchable immediately from client text) and enqueues an Index job.
3. **Queue consumer** (idempotent, retried with backoff, honours the global budget breaker):
   1. **Gather**:
      - For pasted URLs: og/oEmbed (X, TikTok, Instagram, YouTube), then Jina Reader.
      - For PDFs: Workers AI `toMarkdown`; under ~100 characters per page means a scan, which goes to Gemini, and page images are kept for Visual vectors (first 30 pages).
      - For YouTube: Gemini reads the URL and returns a timestamped transcript (videos of 60 minutes or less).
   2. **Deep fetch** if Gather came back thin (ADR-0010): Browser Rendering for JavaScript-only pages, the Cloud Run fetcher for media. Media is temporary; third-party video stays Reference only. Up to 20 a day per user, retried after 1 hour and 24 hours, with a "Try again" button.
   3. **Extract** (skipped for AI opt-out): one structured-output call returns title, description of what's visible, OCR text, entities, Tags and language. Gemma 4 first, Gemini Flash-Lite for overflow, invalid output, scans and video.
   4. **Colours**: dominant palette from the image or thumbnail.
   5. **Categorise**: Jev with the user's full Category list. Every Category above the threshold is assigned, up to 3, with at least 1. Skipped when categories are locked. Embedding fallback if Jev is down.
   6. **Embed**: Overview, Visual and Passage vectors (ADR-0004).
   7. **Write** the index and set `searchable`. On final failure set `failed` with a reason and offer Retry. Clients poll while anything is `indexing`, so badges change live.
4. **Edits** to title, note, Tags or text body re-index text only. A model or index_version change triggers a low-priority background re-index.

**Free allowance** (one config in `packages/core`): 1 GB storage, 25 MB per upload, 100 Captures a day, first 30 PDF pages indexed, transcripts for videos up to 60 minutes, 20 Deep fetches a day. Paid plans come later; the user record carries a plan field from day one.

## 6. Search

1. **Parse** the query: dates via chrono-node ("last month"), kind, Source, Category and **colour words** ("orange", "dark", "purple sidebar"). The rest is the free-text description. Hinglish and typos are expected.
2. **Instant mode** (every keystroke, under 100 ms): keyword and trigram only, no AI.
3. **Full mode** (on pause or Enter, under 600 ms for the slowest 5%):
   - embed the query, or the image for search by image;
   - one SQL function fuses keyword rank, trigram, best-matching vector per Memory (Overview, Visual, Passage), colour proximity and filters with Reciprocal Rank Fusion;
   - it returns the top ~40 with the part that matched.
4. **Direct / Related**: Jev judges the top ~20 ("is this what the user described?"). Fallback: thresholds tuned on the test set. When nothing is a Direct match we say so honestly, then show Related matches.
5. **Why chips** on every result: "text in image: purple", "looks like: dashboard", "passage at 12:40", "colour: orange", "Category: Design reference".
6. **Browse without words**: filter chips for kind, Source, Category, date and **colour**, which work with an empty query. This is for the design-reference case: you saved something but can't think what to type.
7. **More like this** on every Memory. Inside long Memories the matching passage is highlighted, and "open" jumps to the text fragment, page or timestamp.
8. **Search test set** (`evals/`, ADR-0009):
   - a sample Library of ~150 freely licensed Memories;
   - 30 tricky searches written by agents, plus 20 real vague searches written by the user;
   - it reports how often the right Memory comes first and how often it is in the top 5;
   - it compares our search with a Supermemory baseline and decides vector size, passage length and reranker;
   - CI fails on regression.

## 7. UI / UX: the differentiator

- **Design direction first**: `frontend-design` and `impeccable` write `DESIGN.md` (type, colour, spacing, motion principles, light and dark). `prototype` builds three genuinely different versions of the Library grid and the search experience, and the user picks one. That pick blocks all UI tickets.
- **Components**: shadcn/ui on Tailwind v4, heavily restyled from the design tokens in `packages/ui`. Registry components are chosen with `pick-ui-library`: cmdk, Sonner, Motion, a virtualised masonry grid and a lightbox.
- **Interaction baseline**: keyboard-first, as fast as Raycast or Linear.
  - **⌘K** searches from anywhere and **⌘V** anywhere saves the clipboard.
  - Arrow keys and Enter move through results; Space opens a quick preview.
  - Captures are optimistic, Index state badges change live, and Undo is everywhere.
- **Quality bar on every UI ticket**:
  - `better-interface`, `web-design-guidelines` and `break-ui` (long titles, empty Library, 10k Memories, non-Latin text);
  - `review-animations` whenever there's motion; motion itself is built with `emil-design-eng`, `animate` and `choreograph`;
  - WCAG 2.2 AA, reduced motion, works well on a phone browser (`mobile-native`).
- **Each milestone ends with an `impeccable` polish ticket.** Nothing is done until review findings are fixed.

## 8. AX and DX

- **AX for users' assistants**:
  - The MCP server has OAuth plus a personal access token fallback, and is read-only.
  - Its tools are `search_memories`, `get_memory` and `find_similar`, written with `writing-for-agents`.
  - It returns originals, preserved text, Source links and why each result matched, never summaries.
  - Content is marked as untrusted user data.
  - Each assistant has an activity log and can be revoked on its own.
- **AX for coding agents**:
  - `CLAUDE.md` points to the tracker, glossary and ADRs.
  - Deep modules are enforced by dependency-cruiser.
  - `tdd` is used on backend tickets.
  - `git-guardrails-claude-code` blocks destructive git commands.
  - Every ticket lists the skills to use.
- **DX**:
  - `pnpm dev` starts Postgres in Docker, the Worker (wrangler) and the web app, with a seeded demo Library.
  - Pre-commit checks come from `setup-pre-commit`.
  - CI runs types, lint, dependency rules, tests and the search test set.
  - Environments are local + dev + prod. No preview deploys and no backups for now (decided, revisit at launch).

## 9. Safety, privacy, cost control

- **Privacy**:
  - No Gemini free tier for user data (ADR-0005).
  - AI opt-out per Memory and plain disclosure at sign-up (ADR-0011).
  - No server-side platform logins (ADR-0010).
- **Abuse**:
  - Turnstile on sign-up and per-user rate limits.
  - Cloudflare's CSAM scanning on the file domain.
  - Open sign-up, no invite list.
- **Cost**:
  - The per-user Free allowance.
  - A **global daily AI budget breaker** (default $1/day, cap $20/day): past the limit, imports and re-indexing pause, and fresh Captures still index.
  - An admin page shows cost and usage per user.
- **Prompt injection**: saved content is always data. Extraction output must match the schema, and MCP output is framed as untrusted.
- **Deletion**: Undo for about 5 seconds, then permanent removal from the database, R2 and the vectors. Account deletion and ZIP export are included.
- **Legal at launch**: privacy policy, terms, list of data processors, minimum age 16.

## 10. Milestones

| #   | Milestone                                                                           | Proves                                              |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| M0  | Foundation: accounts, deploy, design direction, app shell + sign-in                 | We can ship for $0, and it already looks like Spark |
| M1  | Core loop: text + images → Indexing → multi-vector hybrid search                    | The promise works end to end                        |
| M2  | Search quality: test set, filters and colour, Direct/Related, search by image       | Vague search is genuinely good                      |
| M3  | Capture from anywhere: links, extension, social, YouTube, Deep fetch, PDFs          | Capture from anywhere on the web                    |
| M4  | Categories: AI, custom, locking, bulk edit                                          | Optional organising without folders                 |
| M5  | Ready for strangers: allowance, account and export, imports, PWA, onboarding, admin | Safe and pleasant to open up                        |
| M6  | Connected assistants (MCP)                                                          | Claude/Codex can use your Library                   |
| M7  | Launch: domain, legal, store listings                                               | Public beta                                         |

Tickets live in GitHub Issues as tracer-bullet slices with blocking edges.

## 11. Risks to watch

- **Workers 10 ms CPU**: keep parsing on the client or with providers, and move to Workers Paid the moment real traffic trips it.
- **Model churn**: Gemini models are being retired and repriced fast, so model IDs live in config and every provider sits behind an interface.
- **Social platforms**: login walls and embed changes. Extension site adapters are best-effort and expected to break occasionally.
- **Neon free storage**: several vectors per Memory fill it faster. The test set tells us whether 768 dimensions are enough.
- **No backups yet**: an accepted risk until launch. Neon's built-in restore window is the only safety net.
- **Search quality is the product**: no search change merges without the test set.
