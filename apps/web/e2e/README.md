# e2e

`*.e2e.ts` are the smoke tests (`pnpm test:e2e`, CI). `*.screenshots.ts` are capture tools: each is selected by an environment variable in `playwright.config.ts` and is never part of CI.

## UI tour

`pnpm --filter @spark/web ui-tour` writes every screen and state, in light and dark at 1440x900 and 390x844, and short videos of the micro-interactions, to `UI_TOUR_OUT` (default `apps/web/test-results/ui-tour`), with an `index.md` that says what each file shows. Files are named `NN-screen-state-theme-width.png`; the same `NN` is the same screen and state in all four.

- Needs the local stack: Postgres with migrations applied (`pnpm dev` or `pnpm db:migrate`). Playwright starts the Worker and the dashboard itself. The tour builds the extension (`pnpm --filter @spark/extension build`) for its popup shots.
- Fake providers only (`INDEXING_PROVIDER=fake`), no keys. The mixed Library of 42 Memories, the search answers and the generated images come from `ui-tour-fixtures.ts` and `ui-tour-harness.ts`, so every run draws the same screens. Each phase signs in as a new person (`tour.<label>.demo.account.<time>`), so the account name is the only thing that changes between runs.
- Takes about six minutes. `-g "<phase>"` runs one phase (`signed out`, `library:`, `new account`, `settings`, `share target`, `extension`, `videos`); its numbers then start at 01.
- A step that cannot reach its state is listed as `NOT CAPTURED` in `index.md` and fails the run at the end, so one broken screen never hides the rest.

The phone pass (390px) emulates a touch device (CDP `Emulation.setTouchEmulationEnabled`), so `pointer: coarse` rules apply: 44px targets, no keyboard hints; the step asserts it. Settings and Admin are shot at the viewport and again scrolled to the bottom (`NN-slug-scrolled-…`), not as one tall page. Extension popup states are shot in a 320px-wide viewport, clipped to the popup's height, light and dark only; the popup's computed font must start with Instrument Sans. The region overlay is shot at 1440 only. A phone Get Started (no Install Extension step) is shot from a Pixel 7 context.

Round-1 coverage includes the phone Navigation menu, Capture and Memory detail
sheets, Appearance, held Library skeletons, and a Captured toast above the active
Selection bar. Each state is checked and captured at both widths and themes;
the desktop counterpart of the phone Navigation menu is the sidebar.

For an isolated run, use a fresh local Postgres database and matching server
ports. For example, after starting Postgres on 5547:

```sh
DATABASE_URL=postgres://spark:spark@localhost:5547/spark pnpm db:migrate
SPARK_WEB_PORT=5188 SPARK_API_PORT=8798 \
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://spark:spark@localhost:5547/spark \
  UI_TOUR_OUT=/data/workspace/spark-memory/.git/factory/review/ui/round-2 \
  pnpm --filter @spark/web ui-tour
```

Run the tour after `pnpm check` finishes, and reserve its port pair for the full
run. Do not reuse another checkout's dev servers or database. The OTP step
asserts that sending the code succeeded before checking its entry screen.
