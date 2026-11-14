# Whole-App Polish, Part A: Accessibility and Consistency

Scope: issue #36 part A. Every screen and state in light and dark at 1440, 390,
320 and 200% text: sign-in, Get Started, the Library wall, Capture, Search,
Memory detail and the viewers (image, PDF, link reader), Categories, bulk edit,
Settings, Admin, the share confirmation, the offline page and the extension
popup. Performance is part B (another branch). Earlier passes (#9, #23, #15,
#33) are not redone; their reviews sit beside this file.

## 1. Automated WCAG 2.2 AA Scan

`apps/web/e2e/a11y.e2e.ts` runs axe (`@axe-core/playwright`, tags `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; that includes colour contrast and
target size 2.5.8) over the whole matrix **light/dark × 1440/390**: four cells,
each with one test per area (signed out, Library, Settings, Admin) that signs in
once and walks every state with shared seeding. Scans wait for fades and slides
to finish (axe reads colour mid-fade as low contrast). Toasts stack and fade on
their own timers, so they are left out of the walk and scanned once, still and
alone. It is part of the default Playwright suite, so a new violation fails CI.

States per cell: sign-in (email, code), offline page; new Library with Get
Started; wall (note, list, link, image, PDF, video); Capture; ⌘K with instant
results, with a query image, with a note, failing; results on the wall, by
image, with No Direct Matches, failing; Memory detail and More Like This; image,
PDF, link and video viewers; Categories; bulk bar and Categories picker; the
Library that cannot load; Settings, its two dialogs, full meters with a paused
import and an Assistant, Settings that cannot load; the share confirmation;
Admin, Admin that cannot load. With `EXTENSION_E2E=1` and a local build, the
extension popup in both themes.

The first scan found nothing on the screens the earlier passes covered. The wider
matrix found two real defects, both fixed: a `role="status"` note inside the ⌘K
listbox (a listbox may hold only options and groups), and Admin's sideways-scrolling
tables, which the keyboard could not reach.

## 2. Impeccable Audit

| Dimension                | Initial | Final | Evidence                                                               |
| ------------------------ | ------- | ----- | ---------------------------------------------------------------------- |
| Accessibility            | 3/4     | 4/4   | Focus under sticky bar fixed, skip link, duplicate file inputs removed |
| Performance              | 4/4     | 4/4   | No new work per frame; observers only render on a real change          |
| Theming                  | 4/4     | 4/4   | Tokens only; both themes scanned and photographed                      |
| Responsive Design        | 3/4     | 4/4   | Sign-in and phone search bar reflow at 320px and 200% text             |
| Implementation Integrity | 3/4     | 4/4   | One `Centred` state, one title tracking token, one sticky-inset hook   |
| Total                    | 17/20   | 20/20 | Chromium evidence, not a physical-device certification                 |

The mechanical detector returned `[]` on `apps/web/src`, `packages/ui/lib`,
`apps/extension/entrypoints` and on the rendered sign-in page.

| Priority | Location                           | Finding                                                                                                               | Resolution                                                                          |
| -------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P1       | Wall, arrow keys (2.4.11)          | The wall's top offset went stale when Get Started mounted above it: arrow-key focus landed ~175px below the viewport  | `Masonry` also watches the page body; test walks 24 tiles on a phone                |
| P1       | Phone sticky bars (2.4.11)         | Focused tiles and controls could sit under the sticky top bar                                                         | `useStickyInset` keeps `scroll-padding-top` at the bar's height; `Masonry` reads it |
| P1       | Every page (2.4.1)                 | A dozen Tab stops of sidebar before the content                                                                       | `Skip To Content`, visible only on focus, first Tab stop                            |
| P1       | Sign-in at 320px, 200%             | `Continue with Email` could not wrap and Turnstile's 300px minimum widened the page by 59px                           | Buttons wrap, column is `minmax(0, 1fr)`, Turnstile minimum is `min(300px, 100%)`   |
| P1       | Phone search bar, 200%             | Searching squashed the field and overlapped the icons (14px of sideways scroll)                                       | The bar wraps; the field keeps a 14rem basis                                        |
| P2       | Settings, Search                   | Hidden file inputs were `sr-only`, so a screen reader met each picker twice                                           | `hidden`, as Capture already did                                                    |
| P2       | Type                               | 22px headings tracked 0 while 28px ones tracked -0.02em; DESIGN.md says 22px and up                                   | `--text-{lg,xl,2xl,3xl}--letter-spacing` from `TYPE_SCALE`; literals removed        |
| P2       | Errors                             | Library, Admin, Settings and the app each drew "Unreachable" differently; Admin had no `main` while failed or loading | One `Centred` in the shell; Admin's `main` wraps every state                        |
| P2       | Toasts at large text               | Sonner's px font stayed 13px while the page grew                                                                      | `text-sm` (rem) on the toast and its action                                         |
| P1       | ⌘K, with a query image or no match | A `role="status"` note sat inside the listbox (axe `aria-required-children`)                                          | The list draws the note `aria-hidden`; one live region after the list reads it      |
| P1       | Admin at 390px (2.1.1)             | The two sideways-scrolling tables could not take focus (axe `scrollable-region-focusable`)                            | Named `region`s with `tabIndex={0}`                                                 |
| P3       | Code step caret                    | The fake caret blinked under reduced motion                                                                           | `motion-reduce:animate-none`                                                        |

Positive findings retained: one tab stop per wall, roving focus, named icon
buttons, Escape and focus return in every dialog, 44px touch targets on the
phone, undo instead of confirmation for deletes, labelled meters, live regions
for export and toasts, `lang`, `color-scheme` and `theme-color` for both themes.

## 3. WCAG 2.2 Checks Axe Cannot Make

| Criterion                    | Result                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.4.3, 1.4.11 contrast       | axe in both themes on every state; `tokens.test.ts` already pins every text pair                                                                                                                                   |
| 1.4.4, 1.4.10 resize, reflow | Test: 320px with root text at 200% on sign-in, Library, Capture, Search menu and results, Memory detail, selection bar, Settings: no sideways scroll, every dialog inside the screen                               |
| 2.4.1 bypass blocks          | Skip To Content (test)                                                                                                                                                                                             |
| 2.4.11 focus not obscured    | Test: 24 arrow-key moves on a 390px wall with Get Started above it keep the focused tile between the sticky bar and the viewport's end. Bottom: the selection bar's 128px `scrollPaddingEnd` stays                 |
| 2.5.7 dragging               | Marquee has the tile check control (always shown on touch), Shift/⌘-click and ⌘A. Image viewer swipe has always-visible Previous Image and Next Image. Drop Capture has paste and Choose Files. Nothing else drags |
| 2.5.8 target size            | axe `target-size` on every screen; index-state button grows with a pseudo-element hit area                                                                                                                         |
| 3.3.7 redundant entry        | No step asks twice for what it was given                                                                                                                                                                           |
| Reduced motion               | Test: after a Capture and ⌘K nothing ends scaled or moved (CSS pins `scale: none`; Sonner, Motion, FLIP and the masonry glide already check the media query); caret blink now stops                                |

## 4. Break UI

Worst cases enter through the real API, then every surface that shows a Memory
must stay inside the screen (`a11y-break-ui.e2e.ts`, at 390px and 320px).

| Field        | Boundary                  | Cases                                                                                                              |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Memory body  | 100,000 characters        | Unbroken 272-letter first line, six long lines, one letter, Hindi, Arabic, 150 emoji, 380-character URL, 400 lines |
| Capture Note | 500 characters            | 340 characters with one unbroken run                                                                               |
| Search query | Typed text                | 272 unbroken letters, a word that matches the worst cases, one that matches nothing                                |
| Email        | 254 characters            | 160-character address on the code step                                                                             |
| Screens      | Wall, detail, ⌘K, results | Names stay present on every tile; no sideways scroll; every dialog fits                                            |

The earlier passes' Category, Assistant, import and storage cases stand. No new
break turned up in these; the failures were all reflow (section 2).

## 5. Motion Review, Opportunities and Removal

Reviewed against `DESIGN.md` → Motion with `review-animations`,
`find-animation-opportunities` and `remove-animations`. Nothing exceeds 300ms,
nothing uses `transition: all` or `ease-in`, and only `transform`, `opacity`,
colour and `stroke-dashoffset` move.

| Motion                              | Decision                     | Why                                                           |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| Press scale, hover colour (120ms)   | Keep                         | Direct feedback; scale is off under reduced motion            |
| Capture landing (260ms)             | Keep                         | Explicit decision; CSS removes the scale under reduced motion |
| Dialog, preview fades (150ms)       | Keep                         | Opacity only                                                  |
| Results glide, masonry FLIP (180ms) | Keep                         | A real change of place; the media query removes it            |
| Switch thumb slide (120ms)          | Keep                         | The state change itself, 12px                                 |
| Code step caret blink               | Stopped under reduced motion | The only decoration left running                              |
| Skip To Content                     | No motion                    | Appears on focus without a slide; keyboard path               |

No animation was added: every candidate (sidebar, filters, selection bar,
Get Started) is high-frequency or keyboard-driven.

## 6. Keyboard and Screen-Reader Walkthrough

Keyboard only, from a signed-out profile: sign-in with Tab and Enter, the code
field takes paste and autofocus; Skip To Content lands on the content; ⌘K opens
Search with focus in the field, arrows move through Direct then Related, Enter
puts the wall under focus; arrow keys cross the wall (and stay clear of the
sticky bar); Enter opens Memory detail and Escape returns focus to the tile;
Space and ⌘A select, Escape clears; Settings sections and dialogs are reachable
and close with Escape.

Screen reader: the accessibility tree of the Library, ⌘K, results and Settings
was read in full (Playwright `ariaSnapshot`) rather than listened to. It shows
one `h1` per page, `complementary` for the desk, `navigation` named Library,
`main`, named lists for every wall and filter group, regions named by their
headings, listbox and combobox in the menu, dialogs with names, meters with
labels, and tiles named by title and state. The duplicate unnamed file buttons
were the one defect found (fixed). A listening pass with NVDA, VoiceOver or
TalkBack is **not done** here.

## 7. Better Interface and Web Interface Guidelines

`better-interface`'s six owning skills (`better-accessibility`, `better-layout`,
`better-writing`, `better-typography`, `better-colors`, `better-ui`) are still
absent from `.claude/skills`; those domain reviews are **Not Reviewed** by
those skills, and no holistic approval is claimed. The guidelines
(`vercel-labs/web-interface-guidelines`) were fetched fresh and applied to the
changed files. Where they ask for helper copy, ellipses or loading text, the
project rules in `DESIGN.md` win. Findings applied: skip link, sticky overlays
must not cover focus, hidden file inputs, `text-wrap`, `min-w-0` on flex
children, rem for toast text.

## 8. Deferred

- A listening pass with a real screen reader, and real-device checks (Android
  PWA share sheet, soft keyboard, hardware focus): need hardware.
- Cloudflare Turnstile's own iframe is third-party; its challenge, when shown,
  keeps Cloudflare's 300px minimum inside our 288px column (we cap the
  wrapper; the iframe is theirs).
- `Masonry`'s `scrollPaddingStart` is a new prop-free input read from
  `scroll-padding-top`. Part B (performance) may touch `masonry.tsx` and
  `library-page.tsx`; the changes here are small and local to merge.
