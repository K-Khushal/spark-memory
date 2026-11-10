# pnpm + Turborepo monorepo that shares logic, not UI

The web dashboard, browser extension, API and later the Expo mobile apps live in one pnpm workspace orchestrated by Turborepo. They share TypeScript domain types, Zod schemas, the typed API client and auth setup. They do not share UI components between web and native: universal UI kits (Tamagui, Expo Router web) would slow a solo developer down for little gain at this stage.

## Considered Options

- Nx: more than one developer needs.
- Bun workspaces: viable, but less proven with Metro (React Native), Wrangler and WXT.
