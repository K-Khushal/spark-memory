# Spark design

How Spark looks, moves and responds. Tokens live in `packages/ui`: `tokens.ts` holds them as plain data (for the extension and, later, Expo) and `styles.css` exposes them to Tailwind v4. `packages/ui/tests/tokens.test.ts` keeps the colour tokens in step, checks every text pair for WCAG AA and fails on any warm or tinted neutral. Use [GLOSSARY.md](./GLOSSARY.md) words in every string.

## Principles

- **The bar is Linear and Apple Notes.** One purpose per screen, simple architecture, simple design, simple implementation.
- **No explanatory microcopy.** No taglines, helper text, captions or secondary labels. If a screen needs words to explain itself, fix the layout.
- **No warm neutrals.** Surfaces, text and lines are true greys or carry a faint cool cast. Never cream, beige or paper, in either theme. A test enforces it.
- **The Memories are the colour.** Chrome stays quiet. The one accent is the highlighter, and it marks only what a search found.
- **Serve three readers.** The person using the screen, the developer and the agent editing it next. Clear names, one component per job, tokens instead of literals.

## Pick

The owner chose on 10 November 2026, in their words:

> "Combine Light table and Desk. I loved the pinterest styled masonry wall with a sidebar. Please keep the ui minimal subtle and clean. I want this product to feel as polished as Linear or Apple Notes: simple purpose, simple architecture, simple design, and simple implementation."

The Library is a Pinterest-style masonry wall of Memories beside a quiet left sidebar:

- The **sidebar** holds the wordmark, Capture, Search (⌘K), the Memory kinds, the colour filters and the Categories. It has no counts or headings, because the groups are separated by space alone.
- The **wall** is full-width and virtualised. Tiles show the Memory itself. A title appears under a tile only when the visual does not already show it.
- **Search** opens the ⌘K menu with instant results. Enter puts the results on the wall: Direct Matches first, Related Matches below, each tile with its strongest why-chip.
- **Why-chips** name the part that matched, in a word or the passage itself: Title, Capture Note, Tag, Text, Text in Image, Description, Source, Overview, Image, Page 3 (a PDF's page), or “the words of the passage”. The spark tone marks a Direct Match. Every result tile keeps a 36px footer inside its frame for one, so a chip arriving never moves the wall. A chip that only repeats the filter in force is not shown.
- **Quick preview** (Enter) shows the Memory large with what Spark knows. A permanent details pane was left out, because the preview covers it and the wall keeps its width.
- **On a phone** the sidebar becomes a top bar (wordmark, Search, Capture) over one scrolling row of kind and colour filters. The wordmark is a menu named Navigation: Library, Settings, and Admin for the owner. There is no tab dock. The wall is two lanes.

The reference build is `apps/web/src/prototypes/` at `/prototypes`. `?data=library|empty|huge` gives the break-ui states.

## Colour

| Token         | Light     | Dark      | Use                                                                    |
| ------------- | --------- | --------- | ---------------------------------------------------------------------- |
| `canvas`      | `#FFFFFF` | `#0F1012` | Page and wall                                                          |
| `surface`     | `#FFFFFF` | `#1A1B1E` | Raised things: menus, dialogs, the selected sidebar item               |
| `sunken`      | `#F4F5F7` | `#151619` | Sidebar, wells, why-chips                                              |
| `ink`         | `#111214` | `#EDEEF0` | Text, primary buttons (ink fill, canvas text)                          |
| `ink-muted`   | `#5E6066` | `#9D9FA5` | Secondary text, idle sidebar items; at least 5.7:1                     |
| `line`        | `#E5E6EA` | `#26282C` | Dividers and the sticky phone bar's edge                               |
| `line-strong` | `#898B91` | `#696B71` | Edges that are a control's only boundary (at least 3:1)                |
| `ring`        | `#111214` | `#EDEEF0` | Focus outline, 2px, 2px offset. Text fields: a 2px ink edge, no offset |
| `spark`       | `#FFE15A` | `#FFE15A` | The highlighter: `mark`, the Direct match chip, selection              |
| `on-spark`    | `#111214` | `#111214` | Text on `spark`                                                        |
| `danger`      | `#C4321C` | `#FF8A73` | Index state Failed, destructive actions and validation errors          |
| `indexing`    | `#8F5B00` | `#F0B85C` | Index state Indexing                                                   |
| `searchable`  | `#24774A` | `#74CF95` | Searchable, shown only right after it changes                          |

- Neutrals (`canvas` to `ring`) stay within OKLCH chroma 0.012. Above 0.003 the hue must sit between 200° and 290°, which is cool. The test fails otherwise.
- `--edge` (black at 10%, white at 10% in dark) is the faint ring on floating surfaces and the inset outline on tiles.
- Tailwind's default palette is reset (`--color-*: initial`), so only these tokens exist as classes.
- Badges over imagery (video length) use a fixed ink plate in both themes, because the image under them does not change with the theme.
- The theme comes from the system unless the person picks one. It is set as `data-theme` on `<html>` before first paint.

## Type

- **Instrument Sans** (variable, self-hosted) for all UI and reading text. **Bricolage Grotesque** for the wordmark, dialog titles and headings in text tiles only.
- Hindi uses the bundled Noto Sans Devanagari. Japanese and Arabic fall back to the system's Noto faces. Every title carries `dir="auto"`.
- Scale (size / leading in px): `2xs` 11/16, `xs` 12/16, `sm` 13/20, `base` 15/24, `md` 17/26, `lg` 22/30, `xl` 28/34, `2xl` 40/44, `3xl` 56/58. `sm` is the UI default; `base` is reading text.
- Weights: 400, 500 for selected and titles, 600 for display. Tracking `-0.02em` at 22px and up. Never all caps.
- Tile titles clamp to two lines. The full title is the tile's accessible name and appears in Quick preview.

## Spacing, radius, elevation

- Tailwind's 4px step. Inside a group 4–8px, between groups 20–24px.
- Radius by size: `chip` 6px, `control` 8px (buttons, filters, sidebar items), `tile` 12px, `panel` 16px. No pills: `full` is for colour swatches only.
- Two layered shadows, both with the `--edge` ring: `raised` (the selected sidebar item, the search field, badges) and `overlay` (menus, Quick preview, over a `scrim`). Tiles sit flat with an inset `--edge` outline.

## Iconography

Lucide at 16px, `currentColor`. Every icon-only button has an `aria-label`. Emoji are content, never icons.

## Motion

Motion explains a change; it is never decoration. Values are in `tokens.ts` (`DURATION`, `EASING`, `SPRING`) and as `--duration-*` and `--ease-*` in CSS. `DURATION.preview` (150ms) is the opacity-only fade. Nothing animates on keyboard-driven or high-frequency actions: typing, filters, counts, field growth, the ⌘K menu, a keyboard-opened menu.

| What                                                               | Motion                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press on a button, chip or tile                                    | `scale(0.97)` (tiles `0.98`) on `:active`, 120ms `ease-out`                                                                                                                                                |
| Hover                                                              | Colour only, 120ms. Tiles also fade a 1px `raised` shadow in (`hover-raise`, fine pointer); no lift, no scale                                                                                              |
| ⌘K menu, Escape                                                    | None. Opens and closes on the next frame                                                                                                                                                                   |
| Dialog with `presentation="dialog"`, by pointer                    | Opacity 0 to 1 and scale .98 to 1 from its centre, 180ms `ease-out`. Exit: opacity only, 120ms                                                                                                             |
| The same, from the keyboard; and any dialog with no `presentation` | Opacity 150ms, no scale or slide (Quick preview). Full-screen viewers (image, PDF) do the same whatever opened them                                                                                        |
| Phone sheet (below 640px)                                          | Rises from 8% below with opacity, 260ms `ease-drawer`; leaves in 180ms. Reduced motion: opacity only. The sheet has no grab handle and no drag                                                             |
| Menu opened by pointer                                             | Opacity and scale .98 to 1 from its trigger, 180ms `ease-out`; exit opacity 120ms. Opened from the keyboard: immediate both ways                                                                           |
| Sidebar active item                                                | The raised surface glides to the new item, 180ms `ease-out`, when a pointer moved it. Keyboard and reduced motion: it jumps                                                                                |
| Checkbox                                                           | The check mark draws with `stroke-dashoffset`, 120ms; the box fills with colour, 120ms                                                                                                                     |
| Copied, Note Added, Captured                                       | The icon cross-fades to its confirmed twin, 150ms                                                                                                                                                          |
| Quick preview                                                      | Opacity 150ms, no scale or slide (keyboard-driven and frequent)                                                                                                                                            |
| Filters updating                                                   | None. Results swap in place                                                                                                                                                                                |
| Full results replacing instant                                     | Tiles and ⌘K rows that change place glide there together, 180ms `ease-out`; new ones appear; no stagger. Reduced motion: none                                                                              |
| Tiles moving between Direct and Related                            | Glide from where they stood, 180ms `ease-out`, instead of appearing. Reduced motion: none                                                                                                                  |
| A resurfaced Memory                                                | A repeat Capture moves its Memory to the top: it and the tiles it passes glide, 180ms `ease-out`. Reduced motion: none                                                                                     |
| A Capture landing, a Delete, an Undo                               | The new tile fades and scales from 0.96, 260ms `ease-out`. Tiles that change place glide there, 180ms `ease-out`, `transform` only, no stagger. A removed tile leaves at once. Reduced motion: none        |
| An image arriving on a tile                                        | Opacity 0 to 1 over its ThumbHash, 150ms `ease-out`. Already-cached images (complete on mount) do not fade                                                                                                 |
| Cold load of the Library                                           | The skeleton shows on the first frame. Every later load keeps the 150ms wait                                                                                                                               |
| Segmented control (Appearance)                                     | The `surface` thumb glides to the choice, 180ms `ease-out`, when a pointer moved it. Keyboard and reduced motion: it jumps. Same rule as the sidebar indicator                                             |
| Get Started step change                                            | Step content opacity 150ms. Progress ticks change colour in 120ms. The populated band has a stable minimum height of 104px on phone and 64px on desktop, growing at enlarged text without height animation |
| Tile check control                                                 | Its `surface` plate fades in on tile hover, 120ms; shown at once on a coarse pointer when selection is active                                                                                              |
| Phone sheet opened from a keyboard                                 | Opacity only, 150ms `ease-out`                                                                                                                                                                             |
| Toast placement                                                    | No motion of its own; the next toast uses the new place                                                                                                                                                    |
| Bulk bar                                                           | By pointer or touch the whole bar rises 4px with opacity, 120ms `ease-out`. By keyboard it appears at once. It always leaves at once (see the exception below)                                             |
| Loading                                                            | A static skeleton after 150ms of waiting (a quicker load shows none; a cold load shows it at once), no shimmer or pulse; it fades out over the content in 150ms                                            |
| Image viewer, next or previous                                     | Slides 30% on `SPRING.settle` with a 180ms fade; swipes track 1:1                                                                                                                                          |
| Upload progress ring                                               | `stroke-dashoffset`, 180ms `ease-out`                                                                                                                                                                      |
| Toasts                                                             | Sonner's defaults                                                                                                                                                                                          |

- Never `ease-in`, never `transition: all`, nothing over 300ms. Animate `transform` and `opacity` only, with two exceptions: `stroke-dashoffset` (the upload ring and the check mark). No staggered or scroll-triggered entrances, no blur, no animated height, width or padding, no spring on an ordinary dialog, no motion on typing. `SPRING.fling` (350ms) is over the house maximum and is not used.
- **Input-mode exception:** the same control may move for a pointer and not for a key. Dialogs, menus, the bulk bar and the sidebar indicator read `<html data-input>` (`pointer` or `keyboard`, set by `trackInputModality` in `@spark/ui`) and are immediate when the last input was a key.
- Reduced motion removes all scaling and sliding: `MotionConfig reducedMotion="user"` and a CSS rule pin `scale` to none, the phone sheet falls back to a fade, nothing glides or staggers. Opacity fades stay, up to 150ms.
- Pressing and hovering use the `--duration-press` token; a literal duration in a component fails `packages/ui/tests/tokens.test.ts`.

## Touch, states and the phone

- A coarse pointer (`pointer: coarse`) gets 44px targets (`--size-touch`) on buttons, chips, swatches, checkboxes, menu rows and toast actions while icons stay 16px; inputs are 16px. Keyboard hints (`Kbd`) are hidden there.
- A Button whose label may wrap (a screen at 320px with 200% text) takes `wrap`; it grows instead of clipping. Do not reach for a container rule.
- **A phone sheet** is opt-in: `DialogContent presentation="sheet"` below 640px is bottom-aligned, full width, at most `92dvh`, top corners `panel`, clears the home indicator and rides above the on-screen keyboard. Build it from `DialogHeader`, `DialogBody` (the one scrolling region) and `DialogFooter` (actions, 8px apart, always visible). Padding is 16px on a phone, 24px from 640px. From 640px it is the centred dialog: `max-w-md` for a form, `max-w-2xl` for reading.
- **Empty and error states** are `StateBlock`: one heading and one action, no description. A whole screen centres it (`Centred`); wall search errors and zero results centre within the result region. Inline errors stay beside what they concern.
- **Loading** is `Skeleton` blocks (sunken, tile radius) inside `SkeletonGate`, with the wall's own columns and gaps, so nothing jumps when the Memories arrive.
- **A disabled primary button** is `sunken` with `ink-muted` text and the faint `--edge` ring, never a faded ink slab, so it recedes in both themes.
- **Toasts** are overlay surfaces (`surface`, `ink`, the `--edge` ring and `overlay` shadow) with an ink action carrying a canvas label, in both themes. They sit above anything pinned to the bottom edge: a bar calls `useBottomObstruction` with its element, and the toaster stands at the safe-area edge plus the bar's measured height plus 12px. Below 640px, while any dialog or sheet is open, toasts move to the top (a sheet can stand 92dvh tall), one at a time.

## Settings

Flat groups of rows, no cards: each group has one quiet label (`text-sm`, `ink-muted`), then minimum 48px rows that grow at enlarged text with the label at the start and the control or value at the end, a hairline between rows, groups 24px apart. Appearance is a segmented control (a `sunken` track, a `surface` thumb). Meters are a 4px `line` track with an `ink` fill. One primary action per group at most; a destructive one is a quiet `danger` button.

## Interaction baseline

- **⌘K / Ctrl K** (or `/`) opens Search. Off the Library (Settings, Admin), ⌘K is ignored in text fields and dialogs. Typing shows instant results (keywords); a pause in typing brings the full results (meaning too), which reorder what is there instead of replacing it, and nothing ever empties while a search runs. Enter puts the full results on the wall and focus on its first tile (on the heading when nothing was found). Search By Image is a button inside the field's row, with the query image's chip below it only once there is one; picking an image returns focus to the field, where Enter searches by it. A search that fails says "Search Is Unreachable" with **Try Again**, as a row in ⌘K and a button on the wall. Pressing it says "Searching Again" and marks the list busy until the answer lands; the menu and the wall share one request. A search that is slow dims the results on show after 300ms, so a quick one never flickers.
- **More Like This** is in Memory detail and the image viewer, for a Memory that has vectors (not with AI opt-out, before its first embedding, or without the paid tier). It puts the Memories nearest in meaning and look on the wall, with "More Like This" in the search field, the source Memory as a chip beside the filters (thumbnail and name, as a picked image has) and Clear Search to leave.
- **⌘V / Ctrl V** Captures the clipboard on the Library, outside text fields and dialogs. Off the Library (Settings, Admin), paste is left alone. The Capture button does the same for pointer and touch.
- **Optimistic Capture**: the Memory lands first on the wall as Indexing, and a toast says "Captured" with **Undo**. Failed shows on the tile with a Retry.
- **Index state on tiles** shows only while a Memory is not Searchable: Indexing, or Failed with a Retry whose label says why. Over images it sits on the same fixed dark plate as the upload badge; the image viewer, which has no Memory detail, shows the reason in place of "Failed". The wall asks after Indexing Memories every 2 s, backing off to 30 s, and stops once none are left. While a text tile shows a badge, its last line makes room for it, so the wall never moves when Indexing finishes.
- **Memory detail** has a header (the title, then one meta line: kind, Source host, Capture day) and a property list under the content: Capture Note, Category and AI Opt-Out as labelled 44px rows. Delete is in its More menu, not beside a switch. Why Indexing failed, with Retry, is one line under the title.
- **AI Opt-Out** is a labelled row in Memory detail. The image and PDF viewers have no property list: there it is a checked item in their More menu, beside Delete.
- **Zero results** say "No Memories Match" with Clear Search, centred in the wall area.
- **Preservation on image tiles** shows only while an image is not yet Preserved: a progress ring while it uploads, Failed with Try Again (or Delete, after a reload cut the upload short). A stored image shows no badge, because every stored image is Preserved.
- **Links**: a paste that is exactly one URL Captures a link. Its tile shows the page's title and description, and a last line with its Source host and, while it lasts, Index state or **Reference Only** (no text was kept). Capturing a page again moves its Memory to the top with "Already in Your Library". Memory detail is the reader view: the Source link, then the Preserved text as plain paragraphs. No page image, font or script is ever loaded from the Source.
- **PDFs**: a dropped or chosen PDF lands at once; its first 30 pages are drawn in the browser while it uploads. Its tile is the first page with a **PDF** plate (the ink plate badges over imagery use). It opens in `PdfViewer`: the Indexed pages one under another, opened at the page that matched with the matched passage marked above it, ← → a page at a time, Open PDF for the whole file. A PDF over 30 pages says **Partly Indexed** (beside the controls; at the end of the pages on a phone), and its wall tile wears the same words on the badge plate once it is Searchable, quiet and uncoloured.
- **Videos**: Memory detail plays only after Play (a YouTube video in the privacy-enhanced player, at the moment tapped). Its transcript is one tab stop; ↑ ↓ Home End move between timestamps. A video tile wears a small play mark before its Source host. Timestamps past an hour read h:mm:ss.
- **Images open in `ImageViewer`** for now (← →, swipe, Escape), not Quick preview; it folds into Quick preview when that lands.
- **Get Started** is one band above the wall for a new Library: one step at a time (the AI-processing sentence, Install Extension, Capture ⌘V, Indexing, a vague search ⌘K). Its progress lives on the server, so it resumes on any device. Skip pauses it (not the first step, which carries the AI-processing sentence) and Resume continues; the band is gone once it is finished. Samples wear a **Sample** badge, and **Remove Samples** deletes them all in one action. The first search whose result is opened is recorded once, without the query.
- **Bulk selection** starts with a tile's check control, ⌘/Ctrl-click, a desktop marquee, or a touch long-press. Shift-click selects a range in wall order; clicks and taps toggle while selection is active. The count, Delete, Categories and Clear arrive together in one 120ms rise by pointer or touch (at once by keyboard, none under reduced motion) and leave at once. Categories sets one to three Categories and locks those Memories. Both bulk changes offer the same five-second Undo as deletion; the server receives bounded batches after that window, or when the page closes. A failed batch restores its Memories and offers Try Again with a count.
- **Arrow keys** move spatially on the wall (`neighbour` in `@spark/ui/layout`). Enter opens Quick preview. Space toggles selection; Shift+arrows extend it in wall order. ⌘A / Ctrl A selects the wall, including off-screen Memories. Escape closes the top layer or clears selection.
- One tab stop per wall (roving `tabindex`). Focus is always visible.
- Results always show Direct Matches first and Related Matches apart: Direct under an ink heading with spark why-chips, Related below a hairline under a muted heading with plain ones. With no Direct match the heading says "No Direct Matches", and a row of filter chips under it (the kinds and Categories among the Related Matches) narrows what was found; there is no sentence. ↓ from the last Direct tile goes on to the Related wall and ↑ comes back; in ⌘K the arrows run on from one group into the next.
- Touch targets at least 24px, 44px on a coarse pointer; inputs at 16px so iOS does not zoom.

## Components and libraries

Chosen by hand against `pick-ui-library`'s criteria (that skill is user-invoked; run `/pick-ui-library` to re-check). Everything except Motion lives in `@spark/ui`.

| Need                | Choice                                                        | Why                                                                     |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Base components     | shadcn/ui source (new-york-v4 on Radix), restyled             | We own the source; Radix handles focus traps and Escape                 |
| Command menu        | cmdk via shadcn `Command`                                     | The standard for ⌘K; `shouldFilter={false}` lets search own ranking     |
| Toasts              | Sonner via shadcn `Toaster`                                   | Undo action, swipe, pauses when the tab is hidden                       |
| Motion              | Motion (`motion/react`) in `apps/web`                         | Springs and reduced-motion support                                      |
| Virtualised masonry | `Masonry` on TanStack Virtual (`useWindowVirtualizer`, lanes) | Window scroll, 10k Memories, heights known up front, spatial arrow keys |
| Lightbox            | `ImageViewer` on shadcn `Dialog`, dark in both themes         | ← → and swipe between images; folds into Quick preview when it lands    |
| Icons               | lucide-react                                                  | One stroke, tree-shaken                                                 |

## Copy

- GLOSSARY.md terms only: Memory, Library, Capture, Source, Reference Only, Index state (Indexing, Failed), Category, Tag, Direct Match, Related Match.
- Labels, buttons and headings use Title Case ("All Memories", "More Like This", "No Direct Matches"). The action keeps its name through the flow ("Capture" → "Captured").
- An international Source host reads in Unicode (display only: the stored URL and filters stay ASCII), for Latin names only: a label with any non-Latin character, or any label under a non-Latin TLD, stays punycode, so no lookalike reads as the real host.
- No em dashes, no ellipses except the search placeholder ("Search…"), no counts beside nouns.

## Round 3 Layout Contracts

Settings Library actions use one Import menu row (URLs, Images, Folder) and a separate Library Export row.

Empty Get Started uses a `max-w-xl` composition, `py-6` and a `text-xl` heading. Populated onboarding retains the minimum heights above.

Every result tile footer is 36px including its line border, with a surface background, 8px horizontal inset and a centred 24px why-chip.

Settled asynchronous replacements may relocate tiles over 180ms ease-out. Typing and opening Search with ⌘K remain immediate.
