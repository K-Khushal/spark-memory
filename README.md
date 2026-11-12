# Spark

**Save anything. Find it whenever you need it.** Describe anything you vaguely remember, and Spark finds it.

A personal memory library: Capture links, posts, videos, images, screenshots, PDFs and text from anywhere; Spark Indexes each Memory so you can find it later by meaning, appearance, colour or the text inside it, and gives your AI assistants (Claude, Codex) read access through MCP.

## Repo

```
apps/      server (Cloudflare Worker: API + web hosting) · web (dashboard) · extension (WXT) · fetcher (Deep fetch container) · mobile (Expo, later)
packages/  core · db · auth · api-client · indexing · deep-fetch · search · capture · ui · config
evals/     search test set
docs/      PRD, PLAN, ADRs, research
```

## Getting started

Requires Node 22, pnpm 12 and Docker.

```bash
pnpm install
pnpm dev
```

`pnpm check` runs everything CI runs. See [CLAUDE.md](./CLAUDE.md) for conventions and [docs/PLAN.md](./docs/PLAN.md) for the plan.
