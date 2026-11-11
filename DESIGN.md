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
- **Why-chips** name the part that matched, in a word or the passage itself: Title, Capture Note, Tag, Text, Text in Image, Description, Overview, Image, or “the words of the passage”. The spark tone marks a Direct Match. Every result tile keeps room for one, so a chip arriving never moves the wall.
- **Quick preview** (Space or Enter) shows the Memory large with what Spark knows. A permanent details pane was left out, because the preview covers it and the wall keeps its width.
- **On a phone** the sidebar becomes a top bar (wordmark, Search, Capture) over one scrolling row of kind and colour filters.

The reference build is `apps/web/src/prototypes/` at `/prototypes`. `?data=library|empty|huge` gives the break-ui states.

## Colour

| Token         | Light     | Dark      | Use                                                       |
| ------------- | --------- | --------- | --------------------------------------------------------- |
| `canvas`      | `#FFFFFF` | `#0F1012` | Page and wall                                             |
| `surface`     | `#FFFFFF` | `#1A1B1E` | Raised things: menus, dialogs, the selected sidebar item  |
| `sunken`      | `#F4F5F7` | `#151619` | Sidebar, wells, why-chips                                 |
| `ink`         | `#111214` | `#EDEEF0` | Text, primary buttons (ink fill, canvas text)             |
| `ink-muted`   | `#5E6066` | `#9D9FA5` | Secondary text, idle sidebar items; at least 5.7:1        |
| `line`        | `#E5E6EA` | `#26282C` | Dividers and the sticky phone bar's edge                  |
| `line-strong` | `#898B91` | `#696B71` | Edges that are a control's only boundary (at least 3:1)   |
| `ring`        | `#111214` | `#EDEEF0` | Focus outline, 2px, 2px offset                            |
| `spark`       | `#FFE15A` | `#FFE15A` | The highlighter: `mark`, the Direct match chip, selection |
| `on-spark`    | `#111214` | `#111214` | Text on `spark`                                           |
| `danger`      | `#C4321C` | `#FF8A73` | Index state Failed only                                   |
| `indexing`    | `#8F5B00` | `#F0B85C` | Index state Indexing                                      |
| `searchable`  | `#24774A` | `#74CF95` | Searchable, shown only right after it changes             |

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
- Tile titles truncate to one line. The full title is the tile's accessible name and appears in Quick preview.

## Spacing, radius, elevation

- Tailwind's 4px step. Inside a group 4–8px, between groups 20–24px.
- Radius by size: `chip` 6px, `control` 8px (buttons, filters, sidebar items), `tile` 12px, `panel` 16px. No pills: `full` is for colour swatches only.
- Two layered shadows, both with the `--edge` ring: `raised` (the selected sidebar item, the search field, badges) and `overlay` (menus, Quick preview, over a `scrim`). Tiles sit flat with an inset `--edge` outline.

## Iconography

Lucide at 16px, `currentColor`. Every icon-only button has an `aria-label`. Emoji are content, never icons.

## Motion

Motion explains a change; it is never decoration. Values are in `tokens.ts` (`DURATION`, `EASING`, `SPRING`) and as `--ease-*` in CSS.

| What                              | Motion                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Press on a button, chip or tile   | `scale(0.97)` (tiles `0.98`) on `:active`, 120ms `ease-out`                                                                   |
| Hover                             | Colour only, 120ms                                                                                                            |
| ⌘K menu, Escape                   | None. Opens and closes on the next frame                                                                                      |
| Quick preview                     | Opacity 150ms, no scale or slide (keyboard-driven and frequent)                                                               |
| Filters updating                  | None. Results swap in place                                                                                                   |
| Full results replacing instant    | Tiles and ⌘K rows that change place glide there together, 180ms `ease-out`; new ones appear; no stagger. Reduced motion: none |
| A new Capture landing on the wall | Fades and scales from 0.96, 260ms `ease-out`; neighbours stay put                                                             |
| Image viewer, next or previous    | Slides 30% on `SPRING.settle` with a 180ms fade; swipes track 1:1                                                             |
| Upload progress ring              | `stroke-dashoffset`, 180ms `ease-out`                                                                                         |
| Toasts                            | Sonner's defaults                                                                                                             |

- Never `ease-in`, never `transition: all`, nothing over 300ms. Animate `transform` and `opacity` only. No staggered or scroll-triggered entrances.
- Reduced motion removes all scaling (`MotionConfig reducedMotion="user"` and a CSS rule); opacity fades stay.

## Interaction baseline

- **⌘K / Ctrl K** (or `/`) opens Search from anywhere. Typing shows instant results (keywords); a pause in typing brings the full results (meaning too), which reorder what is there instead of replacing it, and nothing ever empties while a search runs. Enter puts the full results on the wall.
- **More Like This** is in Memory detail and the image viewer, for a Memory that has vectors (not with AI opt-out, before its first embedding, or without the paid tier). It puts the Memories nearest in meaning and look on the wall, with "More Like This" in the search field and Clear Search to leave.
- **⌘V / Ctrl V** outside a text field Captures the clipboard. The Capture button does the same for pointer and touch.
- **Optimistic Capture**: the Memory lands first on the wall as Indexing, and a toast says "Captured" with **Undo**. Failed shows on the tile with a Retry.
- **Index state on tiles** shows only while a Memory is not Searchable: Indexing, or Failed with a Retry whose label says why. Over images it sits on the same fixed dark plate as the upload badge; the image viewer, which has no Memory detail, shows the reason in place of "Failed". The wall asks after Indexing Memories every 2 s, backing off to 30 s, and stops once none are left. While a text tile shows a badge, its last line makes room for it, so the wall never moves when Indexing finishes.
- **AI Opt-Out** is a switch in Memory detail and the image viewer. Memory detail also shows why Indexing failed, with Retry.
- **Preservation on image tiles** shows only while an image is not yet Preserved: a progress ring while it uploads, Failed with Try Again (or Delete, after a reload cut the upload short). A stored image shows no badge, because every stored image is Preserved.
- **Links**: a paste that is exactly one URL Captures a link. Its tile shows the page's title and description, and a last line with its Source host and, while it lasts, Index state or **Reference Only** (no text was kept). Capturing a page again moves its Memory to the top with "Already in Your Library". Memory detail is the reader view: the Source link, then the Preserved text as plain paragraphs. No page image, font or script is ever loaded from the Source.
- **Images open in `ImageViewer`** for now (← →, swipe, Escape), not Quick preview; it folds into Quick preview when that lands.
- **Arrow keys** move spatially on the wall (`neighbour` in `@spark/ui/layout`). Enter and Space open Quick preview. Escape closes the top layer.
- One tab stop per wall (roving `tabindex`). Focus is always visible.
- Results always show Direct Matches first and Related Matches apart. With no Direct match the heading says "No Direct Matches".
- Touch targets at least 24px (aim 44px), inputs at 16px so iOS does not zoom.

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
- No em dashes, no ellipses except the search placeholder ("Search…"), no counts beside nouns.
