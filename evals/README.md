# Search test set

A fixed sample Library (~150 openly licensed Memories) and vague searches with expected answers: 30 tricky ones written by agents (`searches/tricky.json`), plus the product owner's 20 real ones (#10) when they land. It reports how often the right Memory comes first (top-1) and how often it is in the top 5. CI fails on regression. It compares Spark with a Supermemory baseline (ADR-0009) and decides vector size, passage length and reranker (ADR-0004).

**No change to Indexing or search merges without running it** (`pnpm --filter @spark/evals eval`, or let the `search-evals` CI job do it).

## What is measured

The scorer makes a throwaway person, **Captures** every sample Memory through the real code (`Library.capture`, `Library.captureImage`), runs **Indexing** (`createIndexer` and the real Postgres store), then runs every search in **full search** (`createSearch` with the hybrid SQL function). It deletes the person at the end. Needs a local Postgres with migrations applied (`pnpm dev`, or `pnpm db:migrate` against `DATABASE_URL`).

| Mode                   | Providers                                                                                                     | Measures                                                                                | Runs                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| **fake** (default)     | `fakeEmbedder` (words hash to fixed directions) and a replay provider that answers Indexing from the manifest | Search itself: keywords, typos, passages, vector merge. **Not** vision or real meaning. | Everywhere, CI. No keys.     |
| **real** (`eval:real`) | Gemini Flash-Lite and Gemini Embedding 2 on the **paid tier**                                                 | The product: how well Indexing reads images and how well vectors capture meaning        | The owner, on demand. Costs. |

In fake mode, an image is "read" by replaying what Indexing should have found (a caption, the text inside it, tags), recorded in `library/manifest.json`. That makes a CI score about the search, never the model. Real mode is the one to trust for quality. Each mode has its own numbers: only fake mode has a committed baseline.

Real mode refuses to run without `GEMINI_API_KEY` and `GEMINI_PAID_TIER=true` (ADR-0005).

## Commands

```sh
pnpm --filter @spark/evals eval                   # fake providers, print the report
pnpm --filter @spark/evals eval:check             # fail if top-1 or top-5 fell below baseline.json (what CI runs)
pnpm --filter @spark/evals eval:update-baseline   # write baseline.json: do it on purpose, say why in the PR
GEMINI_API_KEY=... GEMINI_PAID_TIER=true pnpm --filter @spark/evals eval:real   # real providers; spends money
```

Add `--json file` to keep the full report. Reports (stdout, `--json`, the CI artifact) carry search ids, ranks, the Memory ids found and counts only, never a query or a Memory's text, because the owner's searches are user content. To see the words while debugging, add `--detail`: it writes `evals/local/detail.json` (git-ignored) with each query and the titles of its top results. The gate compares the searches the baseline knows: top-1 and top-5 may not fall by more than `tolerance` in `baseline.json` (0.02, two points). With 30 to 50 searches that means one lost search fails the gate, on purpose: the fake run is deterministic, so a change in rank is a change in search. The gate also fails when a search in `baseline.json` is missing from the run (a renamed id, a removed file) or when nothing could be compared, so it cannot pass for lack of evidence. A search added later (the owner's) is listed as "not in the baseline yet" and is gated once `eval:update-baseline` has been run.

The fake run is repeatable except for a few ties: `search_memories` breaks some typo-leg ties by physical row order, so three searches (`colour-red-car`, `typo-photosynthesis`, `hinglish-dal-nani`) move a place or two between runs, and `colour-red-car` between #1 and #3. The scorer fixes what it can (Memory ids come from the sample ids, one Memory is Indexed at a time, tables are analysed before searching), and `eval:update-baseline` records each search's worst rank over four runs, so a lucky run cannot set the bar. If the gate ever fails on a search you did not touch, rerun it before suspecting your change. Making the SQL tie-break deterministic is a follow-up (see the PR).

## Direct Matches

Each search also records how the Direct / Related split judged its first 20 results (`SearchOutcome.judged`: sample ids, legs, distance and rank score, never text). The report adds a `Direct Matches` line:

- **precision**: of the results called Direct, the share a person would accept: the search's `expect`, or its optional `also` (other Memories that are just as right; they do not count for top-1 or top-5). A loose match shown as exact is the worse mistake, so this is the number to protect.
- **right one Direct**: of the searches whose right Memory is in the first 20, how many show it as Direct.
- **none Direct**: searches the UI answers with "No Direct Matches".

`eval:tune` (add `--real` for real providers) sweeps `JUDGING.thresholds` over a grid on the recorded signals and prints the best by F0.5 (precision counts twice as much as recall; ties go to the fewest searches with no Direct Match, then to the values nearest today's). Its `Best` line is **in-sample**: the values are tuned on the same 33 searches they are scored on, so the precision there is optimistic. The `Held out` line is leave-one-out: each search is ruled on by values tuned on all the others, which is the number to quote. The `Direct Matches` line in every report is in-sample for the same reason, and it is a regression check rather than a forecast. Copy the best numbers into `packages/core/lib/judging.ts` and bump `JUDGING.version`. In fake mode `directDistance` is left alone: the fake embedder's distances carry no meaning, so only `eval:tune --real` may move it. The thresholds ranked by score (`keywordMinRelative`, `leadRunnerUp`) follow the fusion's structure, which fake and real runs share, so they transfer better, but re-tune all three once the real run is in.

`eval --latency` times full search three times per search under assumed provider speeds (`src/latency.ts`: query embedding p50 150 ms, p95 350 ms; Jev fast, assumed and slow), with the Jev judge replaced by a stand-in that waits a log-normal delay. Jev publishes no latency and there is no key, so the delays are assumptions; the run shows how the deadline behaves around them (full-mode p95 and how often Jev's answer arrives in time). With a key, point the same harness at the real judge before enabling Jev: it should answer in time for nearly every search, or its spend buys nothing.

## Category accuracy

`categories.json` lists, for 98 sample Memories (articles, notes, book excerpts and screenshots), the Categories a person would accept. After Indexing, the report adds a `Categories` line: how often the first Category assigned is accepted, and how often every one is. Counts only. In fake mode the embedder has no meaning, so the number is nearly all Other and means nothing; `eval:real` is where it is read, and where `CATEGORISING.embeddingThreshold` is tuned (`packages/core/lib/categories.ts`). The photographs are not labelled.

## Adding the owner's 20 searches (#10)

No code changes. Commit a file of the same shape next to the others:

```jsonc
// evals/searches/owner.json
[
  {
    "id": "owner-01", // unique across all files
    "query": "that blue app screenshot with the weird chart", // as the owner would type it
    "expect": ["shot-dashboard-dark"], // any one of these sample Library ids counts as right
    "kind": "visual", // what makes it hard; free text, used for the breakdown
    "note": "optional",
  },
]
```

If a search needs a Memory that is not in the sample Library, add it to `evals/library/owner.json` (same shape as `manifest.json`: `kind`, `text` or `file` + `image`, `source.type: "owner"`, and an `extraction` for images so fake mode can replay it), with its file under `library/files/` or `library/texts/`. Every `library/*.json` and `searches/*.json` is read; an `expect` id that does not exist fails loudly. Then run `eval:update-baseline`.

## The sample Library

`library/manifest.json` lists every Memory with its source URL, licence and attribution; texts are in `library/texts/`, images in `library/files/` (147 Memories, about 13 MB in all, most of it the long articles and the photos).

| What                                   | Count | Source and licence                                                                                                   |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| Wikipedia articles (41 short, 10 long) | 51    | Wikipedia, CC BY-SA 4.0, pinned to a revision (`oldid`). Includes Hindi articles. The long ones test Passages.       |
| Public domain book excerpts            | 6     | Project Gutenberg (public domain): Carroll, Conan Doyle, Wells, Austen, Thoreau, Poe                                 |
| Photographs and scans                  | 49    | Wikimedia Commons, only CC0, public domain and CC BY (the assembler refuses any other licence), downscaled to 640 px |
| Screenshots                            | 27    | Drawn for this set from HTML (`scripts/screens.ts`), CC0. The text inside is read back from the page, so it is exact |
| Notes, some in Hinglish                | 14    | Written for this set, CC0                                                                                            |

Skipped on purpose, until they can be Captured: **YouTube** (needs transcripts, whose licence is each uploader's; no YouTube Capture exists yet), **PDFs and links** (the Library has text and image Capture only; M3 adds them). Book excerpts and articles stand in for PDFs as long text. Add those kinds here when their Capture lands.

The `date` searches find a date written inside a Memory. `searches/filters.json` holds searches whose kind, colour and capture date are read out of the words (#12); every sample Memory is captured when the set is built, so "this year" and "since last year" hold the whole Library, and "last month" would hold none. Colour and Source browsing with chips is covered by the database tests, because it has no words to score.

To rebuild after changing `scripts/sources.json`, `notes.json` or `screens.ts`: `pnpm --filter @spark/evals assemble` (needs network and Playwright's Chromium; never runs in CI).

## Comparison and experiments (on demand, never in CI)

Both spend money or credits and call outside services, so each refuses without `--yes`, and both stop if the Library holds the owner's own Memories (`source.type: "owner"`) unless you pass `--include-owner`. The sample Library holds only openly licensed content, never a user's.

```sh
# ADR-0009: Spark against Supermemory on its free credits
SUPERMEMORY_API_KEY=... pnpm --filter @spark/evals compare:supermemory --yes

# ADR-0004: vector size, passage length, reranker (real providers; GEMINI_API_KEY + GEMINI_PAID_TIER=true)
pnpm --filter @spark/evals experiments dimensions --yes   # 768 / 1536 / 3072
pnpm --filter @spark/evals experiments passages --yes     # 1000 / 2000 / 4000 characters
JINA_API_KEY=... pnpm --filter @spark/evals experiments rerank --yes   # none / jina-reranker-m0 / Jev Noul
```

Copy `reports/TEMPLATE.md` to `reports/<date>.md`, paste each table in, write the decision, and update ADR-0004 with the winner. The Jev adapter is built in #13; `rerankers.ts` has the seam.

## Image queries

`searches/images.json` sends the bytes of three sample images as queries through `createSearch`. Fake mode can meaningfully check identical-byte retrieval through Visual vectors (all three must rank first); it cannot measure visual similarity between different images. These three top-1 expectations were added to the baseline without changing any existing rank. Real mode uses the same cases with the paid-tier embedder. The text-only Supermemory comparison skips image cases. Library selection, filters, owner isolation and the exclusion of Passage vectors are covered at the database and HTTP boundaries.
