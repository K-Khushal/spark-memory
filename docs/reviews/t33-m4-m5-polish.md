# M4 and M5 Polish Review

Scope: issue #33; Categories, selection and bulk actions, Settings, imports,
Connected Assistants, PWA installation/share/offline, Get Started and Samples.
React, Tailwind and the existing `@spark/ui` tokens remain the implementation.
Authority: `CLAUDE.md`, `GLOSSARY.md`, `DESIGN.md`, `docs/PLAN.md`,
`packages/README.md` and the cook brief. No ADR is named in the issue.

## 1. Impeccable Audit

The implementation preserves the Desk sidebar, masonry wall, true neutral tokens,
Title Case controls and absence of explanatory helper copy.

| Dimension                | Initial | Final | Evidence                                                              |
| ------------------------ | ------- | ----- | --------------------------------------------------------------------- |
| Accessibility            | 3/4     | 3/4   | Keyboard walkthrough; full share text now reachable                   |
| Performance              | 4/4     | 4/4   | Virtualised selection; no additional production motion/runtime        |
| Theming                  | 4/4     | 4/4   | Existing tokens; four light/dark screenshot pairs per changed surface |
| Responsive Design        | 2/4     | 4/4   | Reproduced 320px/200% overflow; regression test now passes            |
| Implementation Integrity | 3/4     | 4/4   | Local layout fixes; mechanical detector returned `[]`                 |
| Total                    | 16/20   | 19/20 | Chromium evidence, not a physical-device certification                |

| Priority | Location                          | Finding                                                                                   | Resolution                                                                        |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P1       | Settings actions and Export       | Large text puts actions outside the viewport                                              | Wrap actions and allow button text to wrap within the Settings column             |
| P1       | Connected Assistants              | Long names compete with actions; negative margin clips RTL keyboard focus                 | Wrap names, place mobile actions on their own row, remove mobile negative margins |
| P1       | Category manager                  | Fixed-height shrinking rows hide long names in a 50-Category list                         | Minimum-height nonshrinking rows; wrap full names; scroll the list/dialog         |
| P1       | Share confirmation                | Six-line clamp hides what the user is about to Capture                                    | Named keyboard-scrollable preview; bounded dialog                                 |
| P2       | Category editor and bulk picker   | Ellipsis hides full Category names                                                        | Wrap names inside variable-height controls                                        |
| P2       | Account and storage confirmations | Enlarged text can make the dialog taller than the viewport                                | Bound dialog height, enable scrolling, wrap action groups                         |
| P2       | Offline page                      | Content-box minimum height adds unnecessary scrolling; press scale ignores reduced motion | Border-box sizing; explicit Retry focus; gate scale to no-preference              |

Positive findings retained: semantic native controls, named icon buttons, confirmed
account/storage deletion, bulk Undo, live import progress, labelled allowance
meters, token-based contrast and system theme support.

## 2. Break UI

Fixtures enter through API responses or production component props, never edited
rendered markup. The Playwright fixture selects normal data through real sign-in,
then worst-case data through `fixtures(page)`. The existing development-only
selection prototype also has Demo, Worst Case, Empty, One, 1,000 Rows and now
10,000 Rows controls. No test toggle is added to production Settings.

| Field              | Boundary             | Limit                                | Cases                                                                   |
| ------------------ | -------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Category name/list | Categories API       | 40 characters / 50 custom Categories | Long compound name, Arabic, Devanagari, emoji, one-letter name, 50 rows |
| Assistant name     | Assistants API       | 80 characters                        | 78-character name; null last activity                                   |
| Device name        | Account sessions API | Unbounded display string             | Long compound name; current device                                      |
| Memory name        | Usage API            | Title or Source fallback             | Unbroken title and maximum-upload-size PDF                              |
| Allowance counts   | Usage API            | Configured allowance                 | Full daily meters and nearly full storage                               |
| Import progress    | Imports API          | 10,000 entries                       | Paused job, 1,284 done, one skipped, 10,000 total                       |
| Selected count     | Selection prototype  | Library size                         | Empty, one, worst-case, 10,000 selected; virtualisation stays bounded   |
| Shared text        | IndexedDB share hold | Validated share payload              | Forty lines, emoji, keyboard scroll to the last line                    |
| Environment        | Browser              | 320px minimum check                  | 1440/390 light/dark; 320px, 200% root text, RTL; reduced motion         |

Breaks are the P1/P2 findings above; the 320px test failed before the fixes and
passed afterward. Browser screenshots live outside source control under
`/data/workspace/spark-memory/.git/factory/r/t33-{before,after}-*.png`.
Changed production surfaces captured at both required widths and themes:
Settings (including Usage, Sessions, assistants, import and export), account
confirmation, Category manager, Category editor, selection bar, bulk Categories,
offline page and share confirmation.

## 3. Motion Review, Opportunities and Removal

| Before                                                       | After                                       | Why                                                                       |
| ------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- |
| Selection bar fades and slides on every entry into selection | Immediate appearance                        | Space and selection shortcuts must expose actions without entrance motion |
| Category chevron transition runs with reduced motion         | Rotation state remains, transition disabled | Retain the disclosure indicator without animated movement                 |
| Offline Retry press scale always runs                        | Scale only with no motion preference        | Respect reduced motion in the standalone page too                         |

Kept deliberately:

- Get Started's token-based 180ms opacity transition: a rare step change, no
  movement, no stagger and no delay before controls can be used.
- Categorising progress's 180ms transform: communicates an actual value change,
  with `motion-reduce:transition-none`.
- Existing toast transitions: connect Capture/delete feedback and Undo to the
  action; no toast or Undo behavior changed.
- Shared button press feedback: direct feedback, with the existing global
  reduced-motion rule.

No new animation opportunity survived the frequency/purpose/function gate.
Rejected: import/Usage meter entrances (functional data), Category-list stagger
(50 choices must be immediately available), bulk action entrance (keyboard),
and onboarding celebration (would add decoration beyond this brief).
No library removal or orphaned animation code was needed. Motion verdict:
approve within this scope and the explicit `DESIGN.md` opacity-only decisions.

## 4. Keyboard and Interface Review

The walkthrough covers Tab with a visible outline and viewport containment,
Escape, Category rename, reaching the fiftieth Category's Delete control,
selection via Space/Control+A, bulk Categories, and scrolling shared text via
Control+End. Existing smoke tests cover drag selection, delete/Undo, Samples,
imports, account export/deletion and PWA service-worker behavior.

The latest Web Interface Guidelines were fetched from the skill's upstream
source. Relevant fixes address long-content containment, `min-w-0`, visible
focus, enlarged-text reflow, reduced motion and sticky/scrolling surfaces.
Project design rules take precedence over generic suggestions to add helper
copy, ellipses, or extra motion.

The `better-interface` umbrella was read. Its six owning skills
(`better-accessibility`, `better-layout`, `better-writing`, `better-typography`,
`better-colors`, `better-ui`) are absent from the installed project skill set.
Those six formal domain reviews are **Not Reviewed**; the concrete checks above
come from Impeccable, Web Interface Guidelines, break-ui and the keyboard pass.
No holistic approval is claimed for unavailable skills. The installed Impeccable
launcher also lacks its documented `audit-storage` command; this file retains
the audit report instead.

## 5. Code Review

Fixed point: `origin/main` (`8bc1338`), merged after implementation. Review uses
`git diff origin/main...HEAD` and `git log origin/main..HEAD --oneline`. As the
implementation sub-agent, this task is reviewed in-thread; no nested review agents are started.

Standards: token colours and existing components retained; no package boundary,
API, schema, allowance, auth, search, or mutation logic changes. Layout changes
are local to the surfaces that need them. No actionable standards finding after
fixes.

Spec: all named surface groups inspected. Onboarding/Samples, sidebar filters,
connection guide and installation retain their existing presentation where no
new actionable finding was established. New smoke coverage exercises the
reported failures. No new product decision or server behavior is implemented.

Follow-ups/limits: complete the unavailable formal better-interface domain
reviews when those skills are installed; physical Android installation/share
sheet and hardware keyboard/hover feel still need real-device verification.
These are verification limitations, not known unfixed UI defects. No issues
were created, per the cook brief.

## 6. Validation

- `pnpm check`: passed (typecheck, lint, boundaries, formatting, default unit
  suite and builds). The default invocation skips tests requiring a DB URL.
- Real Postgres: `DATABASE_URL=… pnpm --filter @spark/db test
--no-file-parallelism`: 318 passed, including the new migration journal check.
- Full Playwright smoke with the isolated stack and `DATABASE_URL`: 73 passed,
  eight existing opt-in tests skipped. All six new polish cases passed.
- Impeccable mechanical detector: no findings (`[]`).
- 32 before and 32 after screenshots saved at the requested artifact path.

A DB-enabled `pnpm check` exposed a pre-existing test-isolation race: parallel
screenshot and reel-copy tests both drain the global object-removal queue,
occasionally consuming one another's fixtures. Running the DB files sequentially
passes all 318 tests. Follow up on that shared-fixture isolation independently;
no DB or backend source was changed for this UI task. An earlier smoke invocation
without `DATABASE_URL` was corrected before the successful full run.
