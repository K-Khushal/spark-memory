# Spark

Spark is a personal memory library: people save anything they come across and find it again by describing what they vaguely remember. The web phase is a dashboard, a browser extension, an Android PWA share target and an MCP server for Connected assistants. Expo mobile apps come later.

## Read before working

- [GLOSSARY.md](./GLOSSARY.md): the domain vocabulary. Use its terms (Memory, Library, Capture, Indexing, Preservation, Index state, Deep fetch…) in code, tickets and UI copy, and avoid the words it lists under _Avoid_.
- [docs/adr/](./docs/adr/): decisions and why. Don't silently contradict one; say so and argue for reopening it.
- [docs/PLAN.md](./docs/PLAN.md): the implementation plan (stack, data model, pipeline, search, UI bar).
- [docs/research/](./docs/research/): provider facts and prices behind the decisions (dated November 2026; re-check before relying on a number).
- Packages are deep modules: see [packages/README.md](./packages/README.md) before adding or importing one.

## Commands

- `pnpm dev`: Postgres (Docker) + the Worker (`wrangler dev`, :8787) + the dashboard (Vite, :5173, proxies `/api`).
- `pnpm check`: typecheck, lint, package boundaries, formatting, tests, build. It must pass before a ticket is done; CI runs the same steps.
- `pnpm --filter @spark/<name> <script>`: run one package's script.

## Non-negotiables

- **Search quality is the product.** No change to Indexing or search merges without running the search test set (`evals/`).
- **UI is the differentiator.** UI work follows `DESIGN.md` once it exists, and every UI ticket is reviewed with `better-interface`, `web-design-guidelines` and `break-ui` (plus `review-animations` when there's motion) before it's done.
- **Never send user content to Gemini's free tier** (ADR-0005). **Never log into platforms server-side** (ADR-0010).
- **Use `tdd`** for backend behaviour. Use `codebase-design` vocabulary when shaping modules.
- Each ticket lists the skills to use in its **Skills** section. Finish every ticket with `code-review`.
- **Work on a branch and open a PR.** A project hook (`.claude/hooks/block-dangerous-git.sh`) blocks pushing to `main`, force pushes, `reset --hard`, `clean -f`, `branch -D`, `checkout .` and `restore .`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `K-Khushal/spark-memory`, with native blocked-by links. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
