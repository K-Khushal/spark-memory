# @spark/ui

Design tokens and web React components for the dashboard and extension popup, built on shadcn/ui and restyled from DESIGN.md.

Entry point: `index.ts`. Implementation goes in `lib/`, tests in `tests/` (see [packages/README.md](../README.md)).

## Adding shadcn components

Run `pnpm dlx shadcn@latest add <component>` from `packages/ui`. `components.json` points every alias at `lib/`, which `tsconfig.json` maps `@spark/ui/lib/*` to so the CLI can find the folder. That alias is for the CLI only: after adding, change the generated `@spark/ui/lib/...` imports to relative ones (as the existing components do), export the component from `index.ts`, and restyle it from DESIGN.md.
