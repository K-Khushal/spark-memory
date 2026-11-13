# Search By Image Review

Scope: image-query selection, transient upload, filter-chip removal, and Direct/Related results in Search and the Library wall. React, the existing UI components, and DESIGN.md tokens. Conventions inspected: CLAUDE.md, GLOSSARY.md, DESIGN.md, packages/README.md, ADR-0004, ADR-0005 and ADR-0008.

## Code Review

Fixed base: `963a565` (Direct/Related). Independent Standards and Spec reviews inspected `963a565...d69ed98` without running tests. Their findings were fixed locally:

### Standards

| Finding                                                                   | Resolution                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| The initial Library select used 13px on phones and had no minimum target. | Removed in the Opus revision; use Memory actions.              |
| An error used an em dash and loading copy used an ellipsis.               | “Search Unavailable” and “Reading Image”, following DESIGN.md. |
| The embedding path decoded the image twice.                               | Reuse the bounded bytes for hashing and embedding.             |
| Image-query callbacks were repeated across three component interfaces.    | Pass the shared `ImageQueryProps` contract.                    |

Two documented-rule findings and two heuristic smells; all fixed.

### Spec

The removable image chip sat outside the filter controls. It now renders in the existing sidebar/mobile filter controls, and in Search. One partial UI requirement; fixed. No high-confidence functional blocker or scope creep was found.

The implementation agent checked each small fix; no replacement review delegates were started.

## Interface Coverage

The `better-interface` orchestrator skill was read. Its six owning skills (`better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`, `better-ui`) are unavailable in this checkout/catalog. Those six domain reviews are **Not reviewed** under that skill's rules; no holistic approval is claimed. The available Web Interface Guidelines, project rules, independent code reviews, and the checks below provide the actual coverage.

| Domain        | Evidence Inspected       | Result       |
| ------------- | ------------------------ | ------------ |
| Accessibility | Owning skill unavailable | Not reviewed |
| Layout        | Owning skill unavailable | Not reviewed |
| Writing       | Owning skill unavailable | Not reviewed |
| Typography    | Owning skill unavailable | Not reviewed |
| Colors        | Owning skill unavailable | Not reviewed |
| UI            | Owning skill unavailable | Not reviewed |

Web Interface Guidelines were fetched from their primary source on 2026-11-13. Checked controls for accessible names, native keyboard behavior, visible focus, phone input size, narrow layout, dark-theme tokens, image dimensions and non-animated state changes. Image paste is intentionally intercepted to implement the requested search action; ordinary text paste is preserved. The file button and Memory action provide alternatives to file drop. No new motion was added: Search is a frequent keyboard action under `animate`.

## Break UI

Development fixture: `/prototypes?imageSearch=1`, with Demo Data, Worst Case, Empty, One, and 1,000 Memories controls. It uses the production Memory action and named query chip with typed Memory props. Values include a long filename, a 300-character URL title, CJK/RTL/emoji, an empty title and a one-letter title. Memory names and chip text are bounded and truncated; query chips keep the selected Memory's thumbnail when available.

| Severity | Field                    | Failure Found                                      | Fix                                                    |
| -------- | ------------------------ | -------------------------------------------------- | ------------------------------------------------------ |
| Fragile  | Long Memory name         | A query label could exceed a phone container.      | `min-w-0`, `max-w-full`, truncated chip text.          |
| Fragile  | Note body                | An entire note could become an unbounded label.    | Reuse the bounded Memory-name helper.                  |
| Broken   | Search with zero matches | There was no wall action to commit an image query. | Keep the Search action available even with no results. |

A further self-audit reproduced an account-deletion race during asynchronous image hashing. Owner purge tracking now starts before hashing; the new public-interface test failed before the fix and the full 108-test search suite passed afterward.

Browser verification also caught a synthetic query drop bubbling into Capture; nested query drops now stop propagation and the page drag indicator resets in the capture phase. The HTTP Library count stays unchanged after file pick, paste and drop. A mixed Library-vector query could also reintroduce its query Memory through keyword/typo legs; both now exclude it, with a red/green real-Postgres test.

A keyboard probe reproduced CmdK intercepting Enter on query controls. The control row now keeps native activation and navigation keys local while preserving Tab, Escape and the global Search shortcut; the browser test verifies Enter removes the chip without closing Search.

Existing smoke locators remain scoped to Search's listbox. The native Library picker has been removed entirely.

The merged allowance API test exposed a harness timing dependency: recording a mocked Jev call sometimes exceeded its production 350ms deadline under VM contention. This real-Postgres policy test now uses a generous test-only judging deadline; production limits and the controlled-clock deadline/fallback tests are unchanged. All 16 search API tests passed after the adjustment.

No product decisions remain open. Final verification on the branch after merging `f9c69d4` (#27 allowance and rate limits):

- `pnpm check`: passed, including real Postgres, migration tests and production builds. Package and test workers ran serially with extended harness deadlines during VM contention; assertions were unchanged. The temporary runner configuration was restored afterward.
- `pnpm --filter @spark/evals eval:check`: passed before and after. The final run has 36 cases; all three image cases rank first, with no regression against the unchanged existing expectations.
- Playwright smoke: the earlier clean full run passed 49 with 7 existing configured skips. The final full run passed 48, skipped 7, and hit a non-JSON local dev-outbox response in sign-in; that unchanged sign-in test passed on its targeted retry. Both image-query tests passed in the final full run, covering file pick/paste/drop, downscaling, no Capture side effects, Library-vector choice, keyboard controls and worst-case controls.
- Screenshots: 1440 and 390, light and dark, at `/data/workspace/spark-memory/.git/factory/r/t14-search-*.png`. Inspected for wrapping, contrast and chip placement; finite transitions are disabled for stable screenshots.

Verdict: the independent code reviews' actionable findings are fixed. Interface approval is limited to the available guidelines and project rules; the six owning-skill domains above remain Not reviewed. No unresolved HIGH interface finding is known.

## Opus Revision

- S1: Removed the permanent wall control row. Upload is available inside Search and at the desk search field only while focused or searching; paste/drop remain on both surfaces.
- S2: Replaced the loaded-Memory dropdown with Search By Image beside More Like This in detail and the image viewer. It reuses the stored vectors without an embedding call.
- S3: Only `image_search_*` errors and `ProviderError` become 503; other errors reach the normal 500/Sentry path. The public HTTP regression failed before the fix (503 instead of 500), then all three expected/provider/unexpected cases passed.
- S4: A Library query chip shows the selected Memory's bounded name and thumbnail.
- S5: The type/size message is “Use a JPEG, PNG or WebP Under 20 MB”.

The three updated browser tests passed, including field visibility, paste/drop on both surfaces, detail and viewer actions, thumbnail/name identification, no Capture side effects, and worst-case chip labels. Retook `t14-wall-*`, `t14-search-*` and `t14-picked-*` at 1440 and 390 in light and dark themes. Migration 0028 and its timestamp remain unchanged per coordination with #25.

Revision verification: `pnpm check` passed, including the full real-Postgres/API suites and builds; `eval:check` passed without regression (27/36 top-1, 31/36 top-5, all three image cases first). Nine neighboring image/search/focus browser smoke tests also passed. Temporary runner configuration was restored after the check.
