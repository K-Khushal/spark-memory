# Spark Memory: stack research (as of 2026-11-10)

Goal: a "save anything, find it later" app for a solo developer, at about $0/month. Phase 1 is the web dashboard, a browser extension and a PWA share target. Phase 2 is Android and iOS apps with native share sheets. Everything lives in one TypeScript monorepo.

Versions come from the npm registry on 2026-11-10. Free-tier numbers come from the vendors' own pricing and limits pages, linked inline. Prices change, so re-check before you commit.

---

## TL;DR: recommended stack

| Layer | Pick | Why (1 line) |
|---|---|---|
| Monorepo | **pnpm 12 workspaces + Turborepo 2.11** | Expo officially supports this setup, Turbo caching is free, and the config is smaller than Nx. |
| Web app | **Vite 8 + React 19 + TanStack Router (SPA)** | A logged-in dashboard needs no SSR. Static assets on Workers are free and unlimited, and the extension (WXT) is also Vite, so components carry over. |
| Hosting/compute | **Cloudflare Workers** (one Worker serves the SPA assets plus `/api/*`) | It has the best $0 tier with storage, queues, vectors and AI under one account, and serving the SPA from the same origin keeps cookies simple. |
| API | **Hono 4 + `hc` RPC client + Zod 4** | Hono is already the Worker router, Better Auth mounts on it, and one typed client works for web, extension and Expo. Plain HTTP also handles uploads and share-target POSTs. |
| DB | **Cloudflare D1 (SQLite) + Drizzle ORM** | 5 GB free (500 MB per DB), FTS5 full-text search built in, and Drizzle has first-class D1 support and a small bundle. |
| Vectors | **Cloudflare Vectorize** | It is in the free tier, and hybrid search is FTS5 BM25 plus Vectorize kNN, merged in the Worker with RRF. |
| Files | **Cloudflare R2** | 10 GB free with zero egress. Uploads go through presigned URLs or the Worker. |
| Background jobs | **Cloudflare Queues** (move to **Workflows** if the pipeline grows) | Free at 10k ops/day. The ingest pipeline is one idempotent consumer. |
| AI | **Workers AI** (`@cf/baai/bge-m3` embeddings, a small Llama for tags/summary, `toMarkdown` for PDFs) | 10k neurons/day free, and the heavy compute runs on Cloudflare's side, not inside your 10 ms CPU budget. |
| Auth | **Better Auth 1.7** (self-hosted in the Worker, Drizzle/D1) with **Google/GitHub OAuth + email OTP** (Resend free) | $0, no MAU cap, and official Expo and browser-extension guides. Skipping passwords avoids the scrypt CPU-limit trap on the Free plan. |
| Extension | **WXT 0.21** + React | WXT is the most actively maintained option and builds Chrome, Firefox and Safari from one codebase. |
| Mobile (later) | **Expo SDK 58** + Expo Router + **expo-share-intent 9** | Share intent works on iOS and Android, and Expo handles the monorepo Metro config automatically. |
| Errors | **Sentry Developer (free)** + Workers Logs | 5k errors/mo, with SDKs for Workers, React and React Native. |
| Analytics (optional) | **PostHog free** | 1M events/mo, no card needed. |

**When you start paying:** the first bill is **Workers Paid at $5/month**, and it lifts almost every ceiling at once. The usual first trigger is the **Vectorize free cap of 5M stored dimensions (about 4,900 chunks at 1024-d)**, the **10 ms CPU limit**, or **Queues at 10k ops/day**. After that, the next real costs are R2 storage above 10 GB ($0.015/GB-mo) and app-store fees.

---

## 1. Monorepo tooling

| Option | Verdict |
|---|---|
| **pnpm + Turborepo** (turbo 2.11.10, pnpm 12.18) | **Pick.** Expo docs cover pnpm workspaces. SDK 54+ supports pnpm's isolated installs. If an RN library breaks, set `nodeLinker: hoisted` in `pnpm-workspace.yaml` ([Expo monorepo guide](https://docs.expo.dev/guides/monorepos/)). Turbo gives task graph and caching with almost no config. create-t3-turbo uses this same combination. |
| Nx 24 | Powerful (generators, affected graph, Expo plugin), but more concepts and config than a solo developer needs. Worth it only if the repo grows to many apps. |
| Bun 1.4 workspaces | Expo supports Bun workspaces ([guide](https://docs.expo.dev/guides/monorepos/)) and installs are fast. There is no task caching or graph without Turbo, and RN, Wrangler and WXT get less testing under Bun. A reasonable alternative, but not the safe default. |

Expo monorepo facts ([docs](https://docs.expo.dev/guides/monorepos/)):
- Since SDK 52, Metro is configured automatically through `expo/metro-config`. Remove any manual `watchFolders` or `extraNodeModules`.
- Duplicate React or React Native versions break things. Pin React with root `resolutions` or overrides, and use `pnpm why` to find duplicates.
- SDK 55+ enables `autolinkingModuleResolution` for monorepos automatically.

Templates worth reading (not cloning wholesale):
- **[create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)**: pnpm + Turbo, Expo (SDK 54 + NativeWind v5), Next.js 15 or TanStack Start, tRPC v11, **Better Auth** (with an Expo OAuth proxy), Drizzle, and a shadcn `ui` package. It is the best reference for the Expo + Better Auth wiring, but it targets Vercel and Postgres, not Workers and D1.
- **Solito 5** (npm `solito@5.0.0`, 2025-10): for sharing navigation and screens between Next.js and Expo. Only useful if you go fully universal, which is not recommended (see §2).

Expo, current state:
- **SDK 58** was released on 2026-10-15 with RN 0.88, and npm `expo@58.0.23` was published 2026-11-03 ([changelog](https://expo.dev/changelog), [SDK 58](https://expo.dev/changelog/sdk-58)). Until the new Expo Go ships, `create-expo-app` still produces SDK 57. For 58, use `--template default@sdk-58` with a dev build.
- SDK 55 removed the legacy architecture, so only the New Architecture is supported ([SDK 55](https://expo.dev/changelog/sdk-55)).
- SDK 58 Expo Router: data loaders, SSR and middleware are now stable, and web projects default to server output. That matters only if you use Expo Router for web.

Share sheets on mobile:

| Lib | Platforms | Status | Notes |
|---|---|---|---|
| **[expo-share-intent](https://github.com/achorein/expo-share-intent)** 9.0.0 (2026-10-21) | iOS + Android | Tracks every SDK (v9 = SDK 58) | **Pick.** The share opens your main app with the URL, text, images or files. It needs a dev client (no Expo Go). |
| [expo-share-extension](https://github.com/MaxAst/expo-share-extension) 5.0.6 (2026-02-23) | iOS only | Compatibility table stops at SDK 54 | Renders a custom RN view inside the iOS share sheet, so the user saves without leaving the source app. It can share an auth session through keychain access groups. Look at it later for a nicer iOS UX, but it may lag SDK releases. |

---

## 2. Web framework

| Option | Free hosting | Fit for a logged-in dashboard | Code sharing |
|---|---|---|---|
| **Vite SPA + TanStack Router** | Workers static assets: **"free and unlimited"** requests ([docs](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). 20k files and 25 MiB per file on Free ([limits](https://developers.cloudflare.com/workers/platform/limits/)) | Ideal: no SEO needs, no SSR CPU cost, simplest mental model | The same Vite, React and Tailwind stack as the WXT extension, so popup and side-panel components are shared |
| TanStack Start 1.169 | Official Cloudflare partner, `@cloudflare/vite-plugin` ([CF guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)) | Good if you later want SSR or server functions | Server functions are Start-specific RPC. Expo and the extension would still need a plain HTTP API |
| Next.js 16.4 | Vercel Hobby is **"non-commercial, personal use only"** ([Vercel](https://vercel.com/docs/plans/hobby)). On Cloudflare via OpenNext, Node Middleware is unsupported and image optimization needs extra setup ([OpenNext](https://opennext.js.org/cloudflare)) | Overkill for a dashboard. Most of the complexity is around SSR and RSC | Fine, but heavier |
| React Router 8.5 (framework or SPA mode) | Works on Workers | Equivalent to the TanStack Router SPA | Same |
| Expo Router web (universal) | Works, defaults to server output in SDK 58 | A weak fit for drag-drop, dense tables and shadcn-style UI. React Native Web is a compromise on desktop | Maximum sharing |

**Should UI be shared between web and native?** Not for v1. As a solo developer, a web-first DOM UI (shadcn/Tailwind) is faster to build and better on desktop. Share **types, Zod schemas, the API client, auth client setup and business logic** (URL normalization, chunking, search merging, formatters), and share **design tokens**. If you want visual parity on mobile later, NativeWind (4.2.7 stable, **5.0 rc** on Tailwind v4) lets you reuse Tailwind class vocabulary, and Expo "DOM components" (`'use dom'`) can embed a web component inside the native app. Tamagui 3.3 is capable, but it is a big commitment that pays off only if you go fully universal.

**PWA Web Share Target**: supported on Android Chrome 76+ and desktop Chrome 89+. The app must be installed, file shares need `method: POST`, `enctype: multipart/form-data`, and a service-worker `fetch` handler. The URL may arrive in `text` instead of `url` ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)). **iOS Safari does not support it**, so iOS needs the native app. Use `vite-plugin-pwa` for the manifest and service worker.

---

## 3. Browser extension

| Framework | Latest (npm) | Maintenance | Notes |
|---|---|---|---|
| **WXT** | 0.21.5 (2026-10-26) | **Active** | Builds for Chrome, Firefox, Edge and Safari from one codebase. Defaults to MV3 for Chromium and MV2 for Firefox and Safari, overridable with `--mv3` ([docs](https://wxt.dev/guide/essentials/target-different-browsers.html)). Zips, Firefox source zips and publish automation built in. Any UI framework, Vite-based ([compare](https://wxt.dev/guide/resources/compare)). |
| Plasmo | 0.90.5 (**2025-05-17**, no release in about 18 months) | WXT's comparison says it "appears to be in maintenance mode with little to no maintainers" ([compare](https://wxt.dev/guide/resources/compare)) | Parcel-based. Avoid for new projects. Better Auth's extension guide still uses Plasmo, but the same approach works in WXT. |
| CRXJS | npm shows 3.0.0 (2026-09-24). The GitHub releases page lists 2.7.0 (Vite 8 support) ([releases](https://github.com/crxjs/chrome-extension-tools/releases)) | Revived, but only partial cross-browser support | A Vite plugin, not a framework. Supports one manifest version at a time and has no zip or publish tooling. |

Features for this app (standard WebExtension APIs, all available under MV3):
- **Context-menu save**: `chrome.contextMenus.create({contexts: ["page","selection","image","link"]})`. The handler gets `info.selectionText`, `info.srcUrl` and `info.linkUrl`.
- **Visible-area screenshot**: `chrome.tabs.captureVisibleTab()`, which needs the `activeTab` permission. A full-page screenshot needs scroll-and-stitch in a content script. Avoid the `debugger` permission, which shows a scary warning during store review.
- **Page capture**: run Mozilla Readability in the content script and send cleaned HTML or text plus metadata. The server then does no fetching or parsing, which matters under the 10 ms CPU limit.
- **Auth handoff**: the API and web app share one origin (for example `app.example.com`). The extension declares `host_permissions` for that origin and calls the API with `credentials: "include"`. Chrome sends that site's cookies when the extension has host permission. Server side, add `chrome-extension://<ID>` (and the Firefox `moz-extension://` ID) to Better Auth `trustedOrigins`, and never use a wildcard in production ([Better Auth extension guide](https://better-auth.com/docs/guides/browser-extension-guide), [security](https://www.better-auth.com/docs/reference/security)). The UX flow: if there is no session, the popup opens `https://app…/login?from=extension`. After login, the popup detects the session on its next fetch. Pin the extension ID with a `key` in the manifest so the dev ID stays stable.
- **Safari**: WXT builds the extension. Then `xcrun safari-web-extension-converter` wraps it in an Xcode app, which needs a Mac and the **$99/yr Apple Developer Program**. Defer it to the iOS phase, since you pay that fee once for both.
- **Store fees**: Chrome Web Store $5 one-time, Firefox AMO free, Edge free.

---

## 4. Backend and hosting free tiers (exact, current)

### Cloudflare (Workers Free plan, $0; Paid plan is $5/mo minimum)

| Product | Free | Paid ($5/mo) includes | Source |
|---|---|---|---|
| Workers | 100k req/day, **10 ms CPU/request**, 50 subrequests, 128 MB memory, 64 MiB bundle, 5 cron triggers | 10M req/mo, 30M CPU-ms/mo, up to 5 min CPU | [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Static assets | Free and unlimited (except requests routed through `run_worker_first`). 20k files | 100k files | [assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| Pages | Still exists, but Workers with static assets is the current path. Use Workers | – | – |
| **R2** | **10 GB-mo storage, 1M Class A, 10M Class B per month, egress always $0** | $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| **D1** | 5M rows read/day, 100k rows written/day, **5 GB total, 500 MB per DB**, 10 DBs, 50 queries per invocation. FTS5 supported | 25B reads/mo, 50M writes/mo, 5 GB then $0.75/GB, 10 GB per DB | [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/), [SQL/FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/) |
| KV | 100k reads/day, 1k writes/day, 1 GB | 10M reads, 1M writes/mo | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **Queues** | **10k ops/day** (about 3 ops per message, so about 3,300 jobs/day). 24 h retention | 1M ops/mo, then $0.40/M. Retention up to 14 days | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) |
| Workflows | 100k req/day (shared with Workers), **3,000 steps/day**, 1 GB storage | 10M req, 500k steps/mo | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **Vectorize** | **30M queried dims/mo, 5M stored dims**, 100 indexes, 1,000 namespaces/index. Max 1536 dims, 20M vectors/index, 10 metadata indexes | 50M queried, 10M stored, then $0.05 per 100M stored dims | [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), [limits](https://developers.cloudflare.com/vectorize/platform/limits/) |
| **Workers AI** | **10,000 neurons/day** (resets 00:00 UTC) | $0.011 per 1k neurons | [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Hyperdrive | 100k DB queries/day | Unlimited | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers Logs | 200k events/day, 3-day retention. **Moves to "Cloudflare Observability" pricing on 2026-12-01** | 20M/mo, 7 days | [logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Email | Inbound Email Routing to a Worker is free, which allows a free "email it to your memory" feature. **Outbound sending is Paid only** (3k/mo included) | | [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) |

What the free quotas mean in practice:
- **Vectorize 5M stored dims** is about **4,880 vectors at 1024-d** (bge-m3), about 6,500 at 768-d (bge-base) or about 13,000 at 384-d (bge-small, English-only). These are *chunks*, not items, and one PDF can produce dozens. **This is the first ceiling you will hit.** On Paid, 100k chunks at 1024-d costs about $0.05/mo.
- **Workers AI 10k neurons/day**: bge-m3 costs about 1,075 neurons per 1M tokens, so embeddings are effectively free. `llama-3.1-8b-instruct-fp8-fast` costs 4,119 neurons per 1M input tokens and 34,868 per 1M output tokens ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). One item with 2k tokens in and 200 out costs about 15 neurons, so about **650 AI-tagged items/day**. Vision and captioning models cost more.
- **The 10 ms CPU limit is the main technical trap on Free.** Waiting on network I/O (D1, R2, AI, fetch) doesn't count toward it, but password hashing, image resizing and PDF parsing do. Mitigations:
  - No password auth (§5).
  - Make thumbnails in the browser before upload.
  - Convert PDFs with `env.AI.toMarkdown()`, which is "free for most format conversions" ([docs](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)).
  - Have the extension send pre-parsed text.
- **R2 needs a payment method on file** even for the free tier, and its usage is not capped ([community thread](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)). Set billing notifications, allow only authenticated uploads, and enforce per-user quotas.
- **D1 caveat**: `wrangler d1 export` does not support databases with virtual tables, which includes FTS5. You must drop the FTS tables, export and then rebuild them ([docs](https://developers.cloudflare.com/d1/best-practices/import-export-data/)). Treat FTS as a rebuildable index and rely on D1 Time Travel for restores.

### Alternatives

| Service | Free tier (current) | Gotchas | Source |
|---|---|---|---|
| Supabase | 500 MB DB, 1 GB file storage, 5 GB egress (+5 GB cached), 50k MAU, 500k Edge Function invocations, 2 active projects, 50 MB max upload | **Pauses after 1 week of inactivity**, which is bad for a sporadically used personal app. Pro is $25/mo | [pricing](https://supabase.com/pricing) |
| Neon | 100 projects, 1 GB storage per project (20 GB total), 100 CU-hours per project per month, scales to zero after 5 min (cannot be disabled), 5 GB egress, Neon Auth 60k MAU | Cold starts. Launch plan is pay-as-you-go (about $15/mo typical) | [pricing](https://neon.com/pricing) |
| Turso | 100 DBs, 5 GB, 500M rows read and 10M rows written per month | libSQL has native vectors. Developer plan is $4.99/mo | [pricing](https://turso.tech/pricing) |
| Vercel Hobby | 1M function invocations, 4 active CPU-hours, 100 GB transfer | **Non-commercial, personal use only.** When you exceed limits you wait out a 30-day pause | [hobby](https://vercel.com/docs/plans/hobby) |
| Netlify Free | 300 credits (a production deploy costs 15 credits, bandwidth 20 credits per GB) | Credit model, so about 20 deploys/mo if nothing else uses credits | [pricing](https://www.netlify.com/pricing/) |
| Render Free | 750 instance-hours/mo, **spins down after 15 min** (about 1 min to wake) | **Free Postgres is deleted 30 days after creation** (plus 14 days grace) | [free](https://render.com/docs/free) |
| Fly.io | **No free tier for new orgs.** A $1 / 7-day trial. Bills under $5 are waived | Cheapest machine is $2.19 per 30 days | [pricing](https://docs.fly.io/about/pricing) |

**Plan B (if you want Postgres portability):** keep Workers, but use **Neon + pgvector + tsvector through Hyperdrive** (100k queries/day free). Hybrid search becomes a single SQL query, and 1 GB holds roughly 100k+ halfvec embeddings, which is more vector headroom than Vectorize Free. You trade that for cold starts and a separate vendor. Drizzle supports both, so keep the schema in `packages/db` either way.

---

## 5. Auth

| Option | $0 limit | Web | Extension | Expo | Verdict |
|---|---|---|---|---|---|
| **Better Auth** 1.7.19 (self-hosted) | No MAU cap; you pay only your DB | Yes | Official guide: `trustedOrigins` + `host_permissions` ([guide](https://better-auth.com/docs/guides/browser-extension-guide)) | `@better-auth/expo`: SecureStore session, deep-link OAuth, `authClient.getCookie()` for API calls ([guide](https://www.better-auth.com/docs/integrations/expo)) | **Pick.** Auth.js now belongs to Better Auth ([announcement](https://better-auth.com/blog/authjs-joins-better-auth)), and Better Auth joined Vercel on 2026-07-07 while staying "framework and platform agnostic" ([post](https://better-auth.com/blog/better-auth-joins-vercel)). |
| Clerk Hobby | 50k MRU per app | Yes | `@clerk/chrome-extension` | `@clerk/expo` 4.15 | Fast to set up, but Clerk branding stays on, session lifetime is fixed at 7 days, there is no MFA, and you get vendor lock-in. Pro is $25/mo ([pricing](https://clerk.com/pricing)). |
| Supabase Auth | 50k MAU | Yes | Manual | Yes | Ties you to Supabase, including project pausing. |
| Auth.js | – | Next-centric | Awkward | Poor | Maintenance mode. Use Better Auth. |

**Free-plan gotcha:** Better Auth hashes passwords with scrypt by default. Users report "exceeded CPU time limit" errors on sign-up and sign-in on Workers Free, which allows 10 ms ([AnswerOverflow thread](https://www.answeroverflow.com/m/1357795265108512808)). **On Free, use only Google/GitHub OAuth plus the email OTP or magic-link plugin**. Passkeys are also cheap to verify. Send email with **Resend free (3,000/mo, 100/day)** ([pricing](https://resend.com/pricing)). Add email and password later on Workers Paid if you want it.

---

## 6. API layer and ORM

| Option | Notes | Verdict |
|---|---|---|
| **Hono 4.13 + `hc`** | The Worker's router as well. Export `AppType`, and `hc<AppType>()` gives typed calls from web, extension and Expo. Handles multipart, streaming and share-target POSTs. Keep Hono on one version across packages, use `strict` everywhere, and precompile the client types (the `hcWithType` pattern) or split sub-app clients for IDE speed ([RPC guide](https://hono.dev/docs/guides/rpc)) | **Pick** |
| tRPC 11.26 | Great DX, used in create-t3-turbo. On Workers you still need Hono or fetch adapters, and it awkwardly handles file uploads and plain-HTTP endpoints such as share targets, webhooks and email | Fine, but adds a layer |
| oRPC 1.16 | tRPC-like, with first-class OpenAPI output and contract-first design | Pick this instead of Hono RPC only if you want a public, documented API |

| ORM | Notes | Verdict |
|---|---|---|
| **Drizzle** 0.45.4 (1.0 rc.5) | First-class D1 support, tiny bundle, SQL-like API. `drizzle-kit generate` produces SQL that `wrangler d1 migrations apply` runs. The Better Auth Drizzle adapter works with it. Write FTS5 virtual tables as raw SQL migrations | **Pick** |
| Prisma 7.10 (8.0 in rc) | Has a D1 driver adapter, but a heavier client, and the D1 migration flow is clunkier | Skip |

---

## 7. Observability ($0)

| Tool | Free | Use |
|---|---|---|
| **Workers Logs** | 200k events/day, 3-day retention (pricing changes 2026-12-01) ([docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)) | Server logs. Enable `observability` in `wrangler.jsonc` |
| **Sentry Developer** | 1 user, 5k errors, 5M spans, 50 replays, 1 cron monitor, 5 GB logs, 30-day lookback ([pricing](https://sentry.io/pricing/)) | **Pick for errors.** SDKs include `@sentry/cloudflare` 11.11, `@sentry/react` and `@sentry/react-native` |
| PostHog | 1M analytics events, 5k session recordings, 100k exceptions per month, no card, 1-month recording retention ([pricing](https://posthog.com/pricing), [error tracking](https://posthog.com/error-tracking/pricing)) | Add when you want product analytics. It could also replace Sentry, since its free exception quota is larger. Expo SDK 58 includes a one-command PostHog setup |

---

## 8. Architecture sketch

```
extension (WXT) ─┐  POST /api/items (text | url+html | image | screenshot)
web SPA (PWA) ───┼──►  Worker (Hono)  ──► D1 (items, FTS5)  ──► R2 (blobs, presigned PUT)
expo (later) ────┘        │ Better Auth        │
                          └─► Queue "ingest" ──► consumer: toMarkdown(PDF) → LLM tags/summary
                                                 → bge-m3 embed chunks → Vectorize upsert (metadata userId)
search: GET /api/search?q= → FTS5 bm25 top-50 ∥ Vectorize topK-50 (filter userId) → RRF merge → D1 hydrate
```

- Create the Vectorize metadata index on `userId` **before** inserting vectors, or filtering won't work for those vectors.
- Item status: `pending → processed | failed`. Make the consumer idempotent and add a dead-letter queue (DLQ).

### Proposed monorepo layout

```
spark-memory/
├─ apps/
│  ├─ web/           # Vite + React + TanStack Router SPA, vite-plugin-pwa (share_target), Tailwind + shadcn
│  ├─ server/        # Cloudflare Worker: Hono API, Better Auth, queue consumer, cron
│  │                 #   wrangler.jsonc: assets.directory = ../web/dist, run_worker_first = ["/api/*"]
│  ├─ extension/     # WXT + React: popup, context menus, screenshot, content-script Readability
│  └─ mobile/        # (phase 2) Expo SDK 58+, Expo Router, expo-share-intent, NativeWind
├─ packages/
│  ├─ core/          # domain types, Zod schemas, pure logic (url normalize, chunking, RRF, formatters)
│  ├─ db/            # Drizzle schema + migrations (D1), FTS5 raw-SQL migrations
│  ├─ auth/          # Better Auth server config factory + client factories (web/ext/expo)
│  ├─ api-client/    # typed hc<AppType> client + fetch wrappers (re-exports types from apps/server)
│  ├─ ai/            # ingest pipeline: extract → summarize/tag → chunk → embed (Worker-side)
│  ├─ ui/            # shared DOM React components (web + extension), Tailwind preset/tokens
│  └─ config/        # tsconfig bases, Biome/ESLint, Tailwind preset
├─ pnpm-workspace.yaml   # apps/*, packages/*  (nodeLinker: hoisted if RN libs complain)
└─ turbo.json            # build/dev/typecheck/lint/test pipelines
```

---

## 9. Where we start paying (ceilings)

| Trigger | Free ceiling | What it costs |
|---|---|---|
| Vectorize stored dims | 5M (about 4.9k chunks at 1024-d) | Workers Paid at **$5/mo** (10M dims included, then pennies) |
| CPU per request | 10 ms | $5/mo (up to 5 min) |
| Queues / Workflows | 10k ops/day / 3k steps/day | $5/mo |
| Workers AI | 10k neurons/day (about 650 tagged items/day) | $0.011 per 1k neurons on Paid |
| D1 | 500 MB per DB, 5 GB total | $5/mo gives 10 GB per DB, $0.75/GB-mo beyond 5 GB |
| R2 | 10 GB (roughly 20k photos at 500 KB) | $0.015/GB-mo, egress always $0 |
| Workers requests | 100k/day | $5/mo (10M/mo) |
| Email OTP | Resend 3k/mo, 100/day | Resend paid, or Cloudflare Email Service on Paid (3k/mo included) |
| Errors | Sentry 5k/mo | Sampling, or switch to PostHog (100k free) |

Fixed costs outside hosting: a domain (about $10/yr, optional; `*.workers.dev` is free), Chrome Web Store $5 one-time, Google Play $25 one-time, and Apple Developer $99/yr (needed for both iOS and the Safari extension).

**Bottom line:** a single user or a small beta fits in $0 indefinitely. Expect to move to **$5/mo Workers Paid** as soon as you have a few thousand saved items with embeddings, or real users. After that, the cost scales slowly with R2 storage.
