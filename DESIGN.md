# Spark design

How Spark looks, moves and responds. Tokens live in `packages/ui`: `tokens.ts` holds the values as plain data (for the extension and, later, Expo) and `styles.css` exposes them to Tailwind v4. `packages/ui/tests/tokens.test.ts` keeps the two in step and checks every text pair below for WCAG AA contrast. Use [GLOSSARY.md](./GLOSSARY.md) words in every string.

## Direction

Spark is a Library of things you half-remember. The person's Memories are the colour, the imagery and the personality on screen; Spark's own chrome stays neutral, quiet and fast, like a good light table.

One thing is loud: **the highlighter**. Spark Yellow (`spark`) marks what you found and nothing else: the matched words inside a passage, the Direct match label, text selection. Buttons, links and focus never use it, so whenever yellow appears it means "this is what you were looking for".

Mode: an Operate surface with an Experience heart. Scanability and keyboard speed outrank expression, except inside the Memory tiles, where the content leads.

## Colour

Neutral canvas with a faint green-grey cast (paper under daylight), slate in dark mode rather than black. Content colour comes from the Memories.

| Token         | Light     | Dark      | Use                                                                 |
| ------------- | --------- | --------- | ------------------------------------------------------------------- |
| `canvas`      | `#F2F3EF` | `#13161B` | Page background                                                     |
| `surface`     | `#FFFFFF` | `#1B1F26` | Tiles, panels, popovers                                             |
| `sunken`      | `#E8EAE4` | `#0E1014` | Wells, why-chips, hover and selected rows                           |
| `ink`         | `#151714` | `#ECEEE8` | Text, primary buttons (ink fill, canvas text), selected filters     |
| `ink-muted`   | `#585D56` | `#A3A8A0` | Secondary text; ≥ 5.5:1 on canvas, surface and sunken               |
| `line`        | `#DDE0D8` | `#2A2F37` | Hairlines between regions (decorative, not a boundary)              |
| `line-strong` | `#8A8F87` | `#6B727D` | Input and control borders that are the only boundary (≥ 3:1)        |
| `ring`        | `#151714` | `#ECEEE8` | Focus outline, 2px, 2px offset                                      |
| `spark`       | `#E4F04A` | `#E4F04A` | The highlighter: matches, Direct match label, `::selection`, `mark` |
| `on-spark`    | `#151714` | `#151714` | Text on `spark` (14.5:1)                                            |
| `danger`      | `#B42D1A` | `#FF8A73` | Index state Failed, destructive confirmations                       |
| `indexing`    | `#8A5A00` | `#F0B85C` | Index state Indexing                                                |
| `searchable`  | `#2D7048` | `#74CF95` | Index state Searchable, shown only right after it changes           |

- Tailwind's default palette is reset (`--color-*: initial`), so only these tokens exist as classes (`bg-canvas`, `text-ink-muted`…).
- Searchable is the normal case and gets no permanent badge. Indexing and Failed do.
- Colour filters use `FILTER_COLOURS` (12 named colours as people say them: Red, Orange… White). The swatch is the label; its name is the accessible name.
- Dark mode is chosen from the system unless the person picks one. It is set as `data-theme` on `<html>` before first paint, and the theme change itself is not animated.

## Type

- **Instrument Sans** (variable, self-hosted via Fontsource): all UI and reading text. A plain, slightly narrow neo-grotesque that keeps dense metadata calm.
- **Bricolage Grotesque** (variable, optical size axis): display only, at 22px and up: screen titles, the empty Library, the search prompt. Its ink-trap quirks are the one piece of typographic personality.
- Non-Latin text falls back to the system or Noto faces (`Noto Sans JP`, `Noto Sans Devanagari`, `Noto Sans Arabic`), then emoji fonts. Titles are never truncated to one line when they are in a script whose words do not break on spaces; use `line-clamp-2` and `break-words`.

| Token  | Size / leading | Use                                               |
| ------ | -------------- | ------------------------------------------------- |
| `2xs`  | 11 / 16        | Kbd hints, tiny counts                            |
| `xs`   | 12 / 16        | Why-chips, metadata                               |
| `sm`   | 13 / 20        | Controls, tile titles, list rows                  |
| `base` | 15 / 24        | Body, passages, Capture notes                     |
| `md`   | 17 / 26        | Search input, preview titles                      |
| `lg`   | 22 / 30        | Section titles (display face)                     |
| `xl`   | 28 / 34        | Screen titles (display face)                      |
| `2xl`  | 40 / 44        | Search prompt on a large screen (display face)    |
| `3xl`  | 56 / 58        | Reserved for the empty Library and first-run only |

- Tracking: display sizes `-0.02em`, `sm` and below `0`. Never wider than `0.01em`, never all caps.
- Weights: 400 body, 500 controls and titles, 600 display. Emphasis is weight, never colour.
- Numbers that line up (counts, dates, durations) use the `tabular` utility.
- Reading measure 65–75ch for passages and Preserved copies.

## Spacing, radius, elevation

- **Spacing**: Tailwind's 4px step. Inside a group 4–8px, between groups 16–24px, between regions 32–48px. More space above a heading than below it.
- **Radius** by hierarchy, so smaller things get smaller corners: `chip` 6px, `control` 8px, `tile` 12px, `panel` 16px, `full` for filter chips and swatches only.
- **Elevation**: two shadows, both with an offset and soft blur. `raised` for a lifted tile or the floating search bar; `overlay` for popovers, the command menu and Quick preview, always over a `scrim`. An element gets a border or a shadow, never both. Tiles sit flat on the canvas.

## Iconography

Lucide, 1.5px stroke at 16px (inline) and 20px (toolbar), `currentColor`, never filled. Every icon-only button has an `aria-label`. Memory kinds have one icon each: Image `image`, Screenshot `monitor`, Article `newspaper`, Video `play`, PDF `file-text`, Post `at-sign`, Text `text`. Emoji are content, never icons.

## Motion

Motion explains a change; it is never decoration. Values are in `tokens.ts` (`DURATION`, `EASING`, `SPRING`) and as `--ease-*` in CSS.

| What                               | Motion                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Press on any button, chip or tile  | `scale(0.97)` on `:active`, 120ms `ease-out`                                                          |
| Hover                              | Colour only, 120ms, behind `@media (hover: hover)`                                                    |
| ⌘K command menu, Escape            | **None.** Opens and closes on the next frame                                                          |
| Quick preview (Space)              | Opacity 150ms, no scale or slide (it is keyboard-driven and frequent)                                 |
| Filter and search results updating | None per keystroke; results swap in place. A 180ms opacity fade only when the whole set changes       |
| A new Capture landing in the grid  | The one authored moment: tile fades and scales from 0.96, 260ms `ease-out`; neighbours do not animate |
| Index state badge changing         | Cross-fade 180ms                                                                                      |
| Toasts (Sonner)                    | Sonner's defaults; enter and leave from the bottom; swipe to dismiss                                  |
| Sheets on phones                   | Spring `settle` (bounce 0, 0.3s); `fling` (bounce 0.2) only after a flick                             |

- Easing: `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for entering, `--ease-in-out` for moving on screen, `--ease-drawer` for sheets. Never `ease-in`, never `transition: all`. UI motion stays under 300ms.
- Animate `transform`, `opacity`, `clip-path` and `filter` only. No staggered entrances on lists, no scroll-triggered reveals, no looping motion.
- `prefers-reduced-motion: reduce`: transforms are removed, opacity fades stay (Motion's `MotionConfig reducedMotion="user"`). `prefers-reduced-transparency`: the floating bar becomes solid.

## Interaction baseline

Keyboard first, as fast as Raycast or Linear. Every shortcut has a visible equivalent for pointer and touch.

- **⌘K / Ctrl K** opens search from anywhere; `/` also focuses the search field when nothing else is focused. Typing shows instant (keyword) results; Enter runs the full search.
- **⌘V / Ctrl V** anywhere outside a text field Captures the clipboard: a link, an image or text. Drop anywhere does the same.
- **Optimistic Capture**: the Memory appears first in the Library at once with Index state Indexing, and a toast says "Saved to your Library" with **Undo**. Undo removes it with no confirmation. Failed shows on the tile with a Retry.
- **Arrow keys** move between Memories spatially (masonry: same column up and down, nearest tile left and right). **Enter** opens the Memory, **Space** toggles Quick preview, **Escape** closes the top layer and then clears the search.
- One tab stop per grid (roving `tabindex`); focus is always visible with the `ring` outline.
- Search results always show Direct matches first and Related matches apart under their own heading. When nothing is a Direct match, Spark says so plainly before showing Related matches.
- Every result carries why-chips ("text in image: purple", "colour: orange", "passage at 12:40", "Category: Recipe").
- Touch: targets at least 44px, no hover-only actions, `touch-action: manipulation`, inputs at 16px so iOS does not zoom.

## Components and libraries

Chosen by hand against `pick-ui-library`'s criteria (that skill is user-invoked only; run `/pick-ui-library` to re-check). All are installed in `packages/ui`, restyled from these tokens, and exported from `@spark/ui`.

| Need                | Choice                                                                              | Why                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Base components     | shadcn/ui (new-york-v4 source on Radix, Tailwind v4)                                | We own the source, so restyling is editing, not overriding. Radix gives focus traps and Escape handling for free   |
| Command menu        | cmdk via shadcn `Command`                                                           | The standard for ⌘K; `shouldFilter={false}` lets our search own ranking                                            |
| Toasts              | Sonner via shadcn `Toaster`                                                         | Undo action, promise toasts, swipe, pauses when the tab is hidden                                                  |
| Motion              | Motion (`motion/react`)                                                             | Springs, `layoutId` for tile → preview, `AnimatePresence`, reduced-motion support                                  |
| Virtualised masonry | `Masonry` in `@spark/ui`, on TanStack Virtual (`useWindowVirtualizer` with `lanes`) | Window scrolling, 10k Memories, heights from known aspect ratios (no measuring, no jumps), spatial arrow-key moves |
| Justified rows      | `justifyRows` in `@spark/ui/layout` (tested)                                        | Google-Images-style result rows                                                                                    |
| Lightbox            | Quick preview on shadcn `Dialog`                                                    | Memories are not only images (articles, PDFs, video); an image-only lightbox would need a second viewer anyway     |
| Icons               | lucide-react                                                                        | Consistent 1.5px stroke, tree-shaken                                                                               |

## Copy

GLOSSARY.md terms only: Memory, Library, Capture, Source, Preserved copy, Reference only, Capture note, Index state (Indexing / Searchable / Failed), Category, Tag, Direct match, Related match. Sentence case, plain verbs, the action keeps its name through the flow ("Capture" → "Captured"). Errors say what happened and what to do; they do not apologise.

## Prototypes

Three directions for the Library grid and search, at `/prototypes` in `apps/web` (keys `1` `2` `3` switch, `T` toggles the theme; the strip also switches the fake data between the worst-case Library, an empty Library and 1,000 Memories). All three share these tokens and the fake Library in `apps/web/src/prototypes/fake-library.ts` (long titles, Hindi, Japanese and Arabic text, emoji, every kind, Indexing and Failed, Reference only), and differ in layout and character:

1. **Light table**: a full-bleed virtualised masonry wall; chrome collapses to one floating search bar. Results stay a wall, with Direct matches large and Related matches smaller below a rule. The quietest and most visual.
2. **Desk**: a three-pane tool. Filters in a left rail (Kind, Category, colour, Index state), Google-Images justified rows in the middle, a details pane on the right that Space fills. The densest and most keyboard-driven.
3. **Recall**: search first. A large display-face prompt ("Describe what you remember"), the Library as a timeline of days in horizontal shelves, and results as one featured Direct match with its highlighted passage beside the other matches. The most expressive.

## Pick: pending owner's choice

The owner picks one; the pick and its reasons replace this section, and the other two prototypes are deleted in that follow-up commit.

**Recommendation: 1, Light table, borrowing Desk's details pane on wide screens.**

- It is the one that best serves the core promise: people recognise what they saved by sight faster than they read about it, and the wall gives the Memories the most pixels.
- It scales to 10k Memories with one virtualised component, and the same layout works on a 390px phone (two columns, the search bar moves to the bottom within thumb reach).
- Direct and Related stay visually distinct without a second layout, so search results feel like the Library, not a separate screen.
- Desk is the strongest for heavy keyboard use but reads as an admin tool and has the least room for images on a phone. Recall is the most distinctive, but the timeline shelves hide most of the Library behind horizontal scrolling and the featured result costs space when there are several good matches.
