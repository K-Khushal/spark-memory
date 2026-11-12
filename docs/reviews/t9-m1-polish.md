# M1 audit working notes

Scope: text/image Capture, Library tiles and sidebar, Search, Memory detail, ImageViewer, Index state and toast recovery. Base 9f26644; tokens and vocabulary from DESIGN.md and GLOSSARY.md.

## Impeccable audit

Integrity: coherent, existing Desk + masonry design preserved. No palette, typography or architecture replacement.

| Dimension     | Before | Evidence / correction                                                                                 |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Accessibility | 2/4    | Triggerless dialogs can leave focus on body after Search or deletion; recover to the wall or Capture. |
| Performance   | 3/4    | Window-virtualised Masonry; exercise 10,000 real-shaped Memories via local API fixture.               |
| Theming       | 4/4    | All affected production styles use existing tokens.                                                   |
| Responsive    | 2/4    | Detail lacks whole-dialog scrolling; image failure badge shares the phone toolbar row.                |
| Integrity     | 3/4    | Narrow UI-only corrections; no schema or API behaviour changes.                                       |

## Break UI field map

| Field                 | Boundary           | Limit                          | Cases                                                             |
| --------------------- | ------------------ | ------------------------------ | ----------------------------------------------------------------- |
| Title                 | Memory.title       | 300                            | Long multiword, Hindi, Japanese, Arabic, emoji, J                 |
| Body                  | Memory.body        | 100,000                        | Multiline, long source URLs, null for images                      |
| Capture Note          | Memory.captureNote | 500                            | Empty; editing covered in existing smoke                          |
| Index State / failure | enum               | Indexing / Searchable / Failed | Mixed, unavailable failure                                        |
| Image                 | Memory.image       | 25 MB upload                   | Local 640x480; existing image tests cover failed/stranded uploads |
| Library               | API list           | Paginated, no aggregate limit  | Empty, one, 10,001 including image                                |
| Search                | instant/full API   | Ranked results                 | Existing full-search smoke, keyboard result selection             |

## Motion review and subtraction

| Motion                             | Decision     | Purpose / gate                                                                   |
| ---------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Capture scale/fade, 260ms ease-out | Keep         | Explicit DESIGN.md decision, newly Captured Memory; reduced motion strips scale. |
| Button/tile press, 120ms           | Keep         | Feedback, no hover transforms.                                                   |
| Command menu                       | Keep instant | Keyboard frequency rejects entrances/exits.                                      |
| Detail / viewer opacity, 150ms     | Keep         | Explicit DESIGN.md decision.                                                     |
| Search rows / wall FLIP, 180ms     | Keep         | Real ranking change; matchMedia removes movement.                                |
| Viewer spring + 180ms fade         | Keep         | Direction and swipe continuity; MotionConfig reducedMotion=user.                 |
| Original image opacity             | Keep         | Thumbnail-to-original continuity.                                                |
| Upload ring dashoffset             | Keep         | Explicit DESIGN.md progress exception, not decorative.                           |
| Sonner defaults                    | Keep         | Explicit DESIGN.md decision; Undo continuity.                                    |
| Sidebar/filter/Index state         | Keep static  | Functional, frequent; no added animation.                                        |

No animation removed: documented design decisions take precedence over generic skill preferences. No new opportunity survives frequency/function gates. Rejected: command entrance (keyboard), badge pulse (functional state), wall stagger (frequent and forbidden in DESIGN.md).

## Better Interface coverage

The required better-interface SKILL.md is present. Its six owning skills (better-accessibility, better-layout, better-writing, better-typography, better-colors, better-ui) are absent under .claude/skills; all six domains are formally **Not reviewed by those skills**. Direct inspection under impeccable and freshly fetched Web Interface Guidelines still covers the applicable checks; this is not claimed as a complete better-interface approval.

## Follow-ups / limits

- Physical phone gesture feel and soft-keyboard occlusion need real hardware.
- Provider-backed ranking quality is outside this UI pass; smoke uses the local fake Indexing provider.
- Worst-case list is seeded at the API response boundary, not bulk inserted into production or the database.

## Findings fixed

| Severity | Location                                    | Before                                                                    | After                                                                                                       | Why                                               |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| P1       | Memory detail, Search, Capture, ImageViewer | Triggerless Radix dialogs return focus to body, especially after deletion | Close-auto-focus returns to the wall's roving tab stop or visible Capture, while preserving dialog handoffs | Keyboard continuation and visible focus           |
| P1       | MemoryDetail                                | Whole panel cannot scroll; fixed controls can shrink at large text sizes  | Panel scrolls within 90dvh; title, note and action row retain size                                          | Reach controls at narrow widths and 200% text     |
| P1       | ImageViewer                                 | Failed Indexing badge overlaps AI Opt-Out on phones                       | Badge gets a second row; image reserves that space                                                          | Recover Indexing without obscuring other controls |
| P2       | Capture                                     | Tall paste form can extend past a short viewport                          | Panel scrolls within 90dvh                                                                                  | Keep Capture actions reachable                    |
| P1       | Detail and viewer                           | Initial keyboard focus lands on a panel with outline-none                 | Explicit inset token focus ring                                                                             | Show the focus destination before Tab             |

The focus repair runs at Radix's close-auto-focus seam rather than guessing an animation timeout. Search handing directly to detail or Capture leaves the new dialog's focus scope in charge.

## Web Interface Guidelines

Fetched the current vercel-labs/web-interface-guidelines `command.md` on 2026-11-12. Reviewed M1 files and shell. Findings above address focus and narrow/zoomed panels. Labels, dir=auto, native text fields, reduced-motion handling, lazy images and virtualisation were retained. Wall listitem semantics and image dimensions are intentional existing patterns: accessible names live on the roving tile and layout dimensions are supplied by Masonry / aspect ratio.

## Evidence and reproduction

- `SPARK_EXPECT_TIMEOUT=30000 SPARK_WEB_PORT=5199 SPARK_API_PORT=8799 pnpm --filter @spark/web exec playwright test polish.e2e.ts --workers=1`
- `POLISH_SCREENSHOTS=1 POLISH_PHASE=after SPARK_EXPECT_TIMEOUT=30000 SPARK_WEB_PORT=5199 SPARK_API_PORT=8799 pnpm --filter @spark/web exec playwright test --workers=1`
- Screenshots: `/data/workspace/spark-memory/.git/factory/r/t9-{before,after}-{wall,viewer,detail,capture,search}-{1440,390}-{light,dark}.png`.
- The screenshot suite seeds local API responses from a Memory captured against the local Worker; the visual matrix uses 24 worst-case text Memories plus an image. The separate huge case loads 10,000 text Memories plus that image, checks virtualisation, and scrolls to the last Memory. Its data picker exists only inside the test browser.
- Slow connection uses CDP throttling (500ms latency, 1 MB/s down, 20 KB/s up). Large-text case uses 320px width and a 200% root font; reduced motion is emulated. No physical-device test is claimed.
- Impeccable source detector: zero findings (`detect apps/web/src/library apps/web/src/shell.tsx --json` returned `[]`).
- Keyboard regression was reproduced against 9f26644: after Search → Memory → Delete, Capture remained inactive instead of receiving focus.
