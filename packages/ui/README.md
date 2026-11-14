# @spark/ui

Design tokens and web React components for the dashboard and extension popup, built on shadcn/ui and restyled from DESIGN.md.

Entry point: `index.ts`. Implementation goes in `lib/`, tests in `tests/` (see [packages/README.md](../README.md)).

## Adding shadcn components

Run `pnpm dlx shadcn@latest add <component>` from `packages/ui`. `components.json` points every alias at `lib/`, which `tsconfig.json` maps `@spark/ui/lib/*` to so the CLI can find the folder. That alias is for the CLI only: after adding, change the generated `@spark/ui/lib/...` imports to relative ones (as the existing components do), export the component from `index.ts`, and restyle it from DESIGN.md.

## Shared states and overlays

How each is meant to be used is in [DESIGN.md](../../DESIGN.md) → Motion and → Touch, states and the phone.

- **Dialogs:** `DialogContent` is centred by default. `presentation="sheet"` makes it a bottom sheet below 640px; `"fullscreen"` is for viewers (fade only). Compose reading dialogs from `DialogHeader`, `DialogBody` (the one scrolling region) and `DialogFooter`. Call `trackInputModality()` once at start-up so a keyboard-opened dialog or menu skips the pointer entrance.
- **Buttons:** `wrap` lets a long label grow the button. A coarse pointer gets 44px targets from `--size-touch` with no change to icon size. `wrapping-buttons` is the old container rule; do not add new uses.
- **Empty, error and loading:** `StateBlock` (heading plus one action; `align="centre"` for a whole screen), `Skeleton` blocks inside `SkeletonGate` (appears after 150ms, fades out in 150ms).
- **Toasts and bars pinned to the bottom:** call `useBottomObstruction(ref)` from the bar; `Toaster` stacks above it.
- **Small controls:** `Checkbox` (the check draws in 120ms), `CrossfadeIcon` (Copied, Note Added, Captured), `Menu` (pointer entrance from the trigger, instant by keyboard).
