# #36 Part B: Performance

Scope: performance only. Part A owns accessibility, visual consistency, every-screen axe coverage and the full keyboard/screen-reader walkthrough. This PR does not close those acceptance criteria. No ranking, schema, styling or copy changes.

## Reproduce

Use a throwaway local `pgvector/pgvector:pg17` container, a random host port and the local Worker (`INDEXING_PROVIDER=fake`, the default in wrangler.jsonc). Create a database named `perf_spark`, then explicitly export `PERF_DATABASE_URL=postgres://spark:spark@localhost:<random-port>/perf_spark`. Set `DATABASE_URL` (migrations only) and `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to that same URL, then:

```sh
pnpm db:migrate
# Separate terminals, with the same DATABASE_URL and Hyperdrive override:
SPARK_WEB_PORT=5216 SPARK_API_PORT=8816 pnpm --filter @spark/server dev
SPARK_WEB_PORT=5216 SPARK_API_PORT=8816 pnpm --filter @spark/web dev
PERF_DATABASE_URL="$PERF_DATABASE_URL" PERF_BASE_URL=http://localhost:5216 \
  PERF_OUTPUT=/tmp/perf.json \
  PERF_PHASE=after pnpm --filter @spark/evals perf
```

`PERF_PHASE` labels artifacts; it does not switch the code being measured. To reproduce the baseline at `600ed70113e40fd7e394be7e5a78c70ad7228ded`, carry the `evals/perf` harness/command, the local provider preflight endpoint and SearchCommand's two data attributes onto that revision, leaving the lookup/selection changes out. The final pair used the same measurement flow on both revisions.

`PERF_SCREENSHOT_DIR` optionally saves Search at 1440/390, light/dark. `PERF_MEMORIES` defaults to 10,000; `PERF_RUNS` defaults to 40 (minimum 20). Smaller fixture sizes are for debugging, not evidence against the 10k target. Run before and after on the same machine, with no competing check/build/test workload. Delete the container with `docker rm -fv <your-container>` when finished.

The harness requires explicit `PERF_DATABASE_URL` without loading `.env` into the environment. It refuses port 5432 (including the default port), remote hosts, database names outside `perf_*`, connection query/fragment overrides, and the `.env` DATABASE_URL (including loopback aliases and different credentials for the same database). A refusal prints an exact throwaway `docker run` command and port lookup. It checks the running Worker’s local-only `/api/dev/indexing-provider` endpoint before account creation or seeding: only fake Indexing with Jev disabled is accepted, so shell configuration cannot vouch for a paid stack. It then creates a synthetic account through local email-code sign-in, inserts unique synthetic text Memories, and runs every Memory through the real Indexer with fake extraction and embedding. Four concurrent jobs; no paid providers. It asserts every seed job reaches Searchable. It uses the same 768-dimensional embedding space as the local Worker: one Overview and one Passage per text Memory, 20k vectors total. It analyzes the two search tables before measurement. This is a reproducible synthetic text workload, not a representative mixed-media production Library.

Measurements are milliseconds, nearest-rank percentiles, with raw samples and machine metadata in JSON:

- **Server:** `createSearch` + Postgres + fake embedding/budget machinery, excluding HTTP and authentication. Ten queries warmed first; 40 sequential observations per mode. Clear the query-vector cache before each observation. Includes keywords, vague meaning, typos, multiword, non-Latin and no matches.
- **Browser HTTP:** Chromium `fetch` through Vite → Worker → Postgres, including authentication and response body consumption. 40 observations per mode; repeated queries may use the Worker's vector cache. Reject a full answer that fell back to instant.
- **Browser UI:** ten uncached menu queries; fill → matching answer committed → two animation frames. Full includes the intentional 350ms pause. The current query key and answer mode are exposed as data attributes on the command list; they carry no content beyond the query already displayed in the input. Full mode is final; a fast full answer may supersede instant before its paint is observed.
- **Cached UI:** 40 repeated menu queries with the warmed client cache; includes Playwright fill/assertion overhead and two frames. CDP ScriptDuration records page script CPU over this loop; report search request count too. This separates client work from API latency.
- **Capture → Searchable:** ten real API Captures through the local Queue and fake provider, observed every 100ms. Includes Capture HTTP and polling; seed jobs are not used as latency samples.

The harness deletes its synthetic account and Library in `finally`; its local-only authentication data is never printed. Interrupted runs can leave synthetic rows: the dedicated throwaway container is the cleanup boundary. It never deletes existing users to recover from a prior run.

## Results

Same AMD EPYC VM, Node 22.23.3, Chromium, Vite development build, fake provider, 10,000 Searchable text Memories and 20,000 vectors. No own check/build workload ran during the timed phases; other users of this shared VM remain uncontrolled. Treat these as local diagnostic samples, not production capacity or a statistically established speedup. Raw observations: [before](../performance/t36b-before.json), [after](../performance/t36b-after.json).

| Measurement (ms)                                  | Before |  After | Target / Result             |
| ------------------------------------------------- | -----: | -----: | --------------------------- |
| Server instant p95 (n=40)                         |   41.1 |   39.6 | <100: Pass                  |
| Server full p95 (n=40)                            |   77.1 |   69.7 | <600: Pass                  |
| Browser HTTP instant p95 (n=40)                   |  133.2 |  155.5 | <100: Miss                  |
| Browser HTTP full p95 (n=40)                      |  173.2 |  148.3 | <600: Pass                  |
| Browser UI instant p95 (n=10)                     |  251.1 |  232.6 | <100: Miss                  |
| Browser UI full p95, including 350ms pause (n=10) |  635.5 |  616.7 | <600: Miss                  |
| Cached UI p95 (n=40)                              |  117.6 |  118.3 | Diagnostic                  |
| Cached UI script CPU, total over 40 changes       | 1851.7 | 2019.1 | No demonstrated improvement |
| Cached UI search requests                         |      0 |      0 | Cache handoff retained      |
| Capture → Searchable median (n=10)                | 1173.4 | 1124.7 | <30,000: Pass               |

The client change removes whole-Library lookup construction from each search answer/query, shares one lookup across menu/wall/pagination, memoizes selected Memory extraction and skips pruning an empty selection. Search hit assembly now reads that lookup in proportion to hit count. **The measurements do not establish a whole-page CPU win**: total script CPU increased 9% in this single pair, while cached p95 was effectively unchanged. No ranking/debounce change was used to make the numbers look better.

The API/browser gap remains even though direct server search meets its target. Profile request authentication, per-request database connections, response work and the development proxy separately before changing them; the current samples do not identify which dominates. Full UI latency also includes the designed typing pause and browser/test overhead. Do not subtract independent percentiles to claim render time.

Two exploratory runs were discarded: one exceeded a 512MB throwaway DB tmpfs after repeated seeding; another lost its local Worker during browser measurement. The final pair used a 1.5GB tmpfs with `max_wal_size=128MB`, `min_wal_size=32MB`, `checkpoint_timeout=60s`. Both final runs reached cleanup. Screenshots: `/data/workspace/spark-memory/.git/factory/r/t36-b-{before,after}-search-{1440,390}-{light,dark}.png`.

## Review Procedure

Read the issue, DESIGN.md, GLOSSARY.md, PLAN §6–8, package interfaces, ADR-0004/0009 and previous polish PRs #97, #122, #113, #126 plus `docs/reviews/*.md` first. The pass follows the brief's skill order within Part B's narrower scope:

1. **Impeccable optimize:** preserve the Desk/masonry design. Measure render cost and requests before optimizing. Existing tile virtualization remains; avoid another virtualizer or debounce that delays instant search.
2. **Break UI:** use the real 10k-row, 20k-vector synthetic Library, multilingual titles, typo queries and no matches at the API/data seam. Existing #9/#15 fixtures cover empty/one/long titles, 320px/200% text and focus; Part A owns whole-app visual stress. No new production data switch.
3. **Review Animations / Find Animation Opportunities / Remove Animations:** Search opens immediately. Existing full-result FLIP is transform-only at 180ms with reduced-motion protection; it is explicitly required by DESIGN.md. No new motion, no motion deletion, no opportunity survives the frequency gate.
4. **Better Interface:** its six owning skills are absent in this checkout (better-accessibility, better-layout, better-writing, better-typography, better-colors, better-ui); all six procedures are Not Reviewed. No holistic approval claimed. **Web Interface Guidelines:** fetched the primary guideline source on 2026-11-14; apply the controlled-input cost, virtualized-list and batched-layout-read rules to this flow. No DOM measurement added to render.
5. **Keyboard:** the smoke uses Cmd/Ctrl K, types, commits with Enter, and reopens Search; the completed menu answer must reach the wall without another request. Screen-reader verification is assigned to Part A; this performance change does not modify roles, labels or live announcements.

## Done / Deferred

Done: reproducible local measurement, a 10k fake-Indexed fixture, browser/API/Queue timing, shared stable lookups and selection-cost reductions, and cache-handoff smoke coverage. Final code review and checks are recorded below after verification.

Deferred: instant browser latency below 100ms remains unmet. The initial development-build full UI sample also missed 600ms; the production-preview follow-up below meets that target. Profile the HTTP/auth/connection path and test optimized production assets before selecting a server fix; no ranking change or issue creation here. Production provider/network latency, real-phone CPU and mixed-media workloads require another measurement. The Library still eagerly reads every 200-row page so search hits can resolve through local Memories; replacing that hydration model is a separate data-flow change. Whole-app axe and screen-reader checks belong to Part A.

## Code Review

Fixed base: `origin/main` at `600ed70113e40fd7e394be7e5a78c70ad7228ded`. Standards and Spec reviewed in-process because this is an implementation child instructed to do its own work; no independent-agent approval is claimed.

**Standards:** no unresolved source finding. Shared lookup ownership stays in LibraryPage; hooks receive a read-only lookup, preserve hit order and hide missing/pending-deleted Memories as before. Every immutable Library update rebuilds the lookup, so edits, Indexing and AI opt-out still refresh search. Selection pruning with zero ids preserves the original state/anchor exactly. The bulk-row memo depends on both selection ids and Library rows. No package-private imports, new runtime dependency, UI copy/style/token change or production network call.

**Spec:** reproducible 10k fake-provider seed, server/browser measurements, real Queue Capture latency, before/after artifacts and focused cache smoke are present. Browser target misses and the inconclusive CPU result remain explicit follow-ups. No server/ranking change, new issue or scope expansion. Whole-app accessibility/consistency review remains Part A. The synthetic text fixture and development-stack measurements do not establish production performance.

## Verification

- `pnpm check`: passed with real Postgres, under two-CPU process affinity to limit VM contention; no test/config changes or assertions suppressed. Includes types, lint, package boundaries, format, tests and builds.
- `pnpm --filter @spark/evals eval:check`: passed, no regression against `baseline.json`.
- Focused Search-session/selection tests: 24 passed.
- Cache-handoff Playwright smoke on the baseline: 1 passed. Final full-suite smoke results are recorded in the PR.
- Before/after perf runs: each 10,000 Searchable Memories, 20,000 vectors; 40 server and HTTP samples per mode, 10 uncached UI queries, 40 cached interactions, 10 fresh Captures.

## PR Review Fixes And Production Preview

S1: the harness now requires `PERF_DATABASE_URL` before reading `.env`, never imports the eval setup module, and opens only the guarded URL. Pure guard tests cover missing/malformed URLs, remote hosts, implicit/explicit 5432, non-`perf_*` names, URL overrides and alias/credential variants of the `.env` database. Every refusal includes the exact throwaway container command.

S2: before account creation or seeding, the harness reads the running Worker's `/api/dev/indexing-provider` endpoint. It requires fake Indexing and disabled Jev, including rejecting missing preflight fields. The endpoint returns 404 outside local development. Guard and HTTP tests cover paid/missing providers, enabled Jev and production isolation.

S3: each request-count equality assertion in `performance.e2e.ts` now waits for `networkidle` (500ms of quiet) first, so delayed requests have time to appear in the count.

S4: measured a fresh 10k/20k-vector Library with production assets, while keeping the same local Wrangler Worker and fake providers:

```sh
pnpm --filter @spark/web build
SPARK_API_PORT=8816 pnpm --filter @spark/web preview --port 5216 --strictPort
PERF_DATABASE_URL=postgres://spark:spark@localhost:32829/perf_spark \
  PERF_BASE_URL=http://localhost:5216 PERF_PHASE=preview \
  PERF_OUTPUT=/tmp/t36b-preview.json pnpm --filter @spark/evals perf
```

The Vite preview server proxied `/api` to the unchanged Wrangler development server. Preflight confirmed fake Indexing and disabled Jev. Raw observations: [production preview](../performance/t36b-preview.json). Same AMD EPYC VM / Node 22.23.3, still synthetic text and local fake-provider latency; no own check/test workload ran during timing.

| Preview Measurement (ms)              |   n |    p50 |    p95 |
| ------------------------------------- | --: | -----: | -----: |
| Browser HTTP instant                  |  40 |  104.5 |  134.2 |
| Browser HTTP full                     |  40 |  127.9 |  154.4 |
| Browser UI instant                    |  10 |  163.4 |  198.6 |
| Browser UI full, includes 350ms pause |  10 |  534.1 |  581.4 |
| Cached UI                             |  40 |   51.2 |   76.4 |
| Capture → Searchable                  |  10 | 1177.3 | 2030.7 |

Cached UI script CPU was 629.4ms total for 40 changes with zero search requests. Server instant/full p95 were 40.8/76.3ms. Full UI is below 600ms in this preview sample; browser instant remains above 100ms. This tests the development-build explanation without establishing that development overhead explains the entire remaining gap. The earlier dev-build measurements and their misses remain recorded above.

Review-fix validation: `pnpm check` passed with `--concurrency=2` on each Turbo task (scheduling-only root script overrides restored afterwards). The gate included 17 pure guard tests and 3 dev-provider endpoint tests. The hardened perf e2e passed against the production-preview stack: 1 passed, 6.4s test / 8.4s total. No source assertions were suppressed. The dedicated perf DB container is removed after validation and commit hooks.
