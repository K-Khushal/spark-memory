# Deploying Spark

One Cloudflare Worker serves the dashboard and `/api/*` (ADR-0003). It runs in two Wrangler environments, each with its own Neon database behind its own Hyperdrive config:

| Environment  | Worker name        | Deploys when                                                                                  |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `dev`        | `spark-dev`        | every push to `main`, after CI passes                                                         |
| `production` | `spark-production` | a `v*` tag, or **Run workflow** on `main` with _deploy_production_, after a reviewer approves |

The top level of `apps/server/wrangler.jsonc` is for local `wrangler dev` only and is never deployed.

A tag deploy also waits for the `production` reviewers. The tag rule `v*` on the environment limits who can trigger it; remove the reviewers if you want tags to deploy unattended. Both Sentry SDKs tag events with the environment (`dev` or `production`).

Until `CLOUDFLARE_API_TOKEN` is set, the dev deploy is skipped with a notice in the CI run. Once it is set, a missing secret or placeholder Hyperdrive id fails the deploy with a message naming what is missing.

## Local development

```sh
cp .env.example .env
pnpm dev        # Docker Postgres + pgvector, db:migrate, db:seed, Worker on :8787, dashboard on :5173
```

`wrangler dev` skips Hyperdrive and connects straight to Docker Postgres through `localConnectionString`. To point it elsewhere, set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. Sentry stays off locally.

## One-time setup

1. **Neon.** Create the dev and prod databases (region `aws-ap-southeast-1`). For each one, copy the **direct** connection string, with connection pooling turned off in the Connection Details pane, because Hyperdrive does the pooling.
2. **Hyperdrive.** Create one config per database, then put each returned `id` in `apps/server/wrangler.jsonc` in place of the placeholder:

   ```sh
   cd apps/server
   npx wrangler login
   npx wrangler hyperdrive create spark-dev  --connection-string="<Neon dev direct string>"
   npx wrangler hyperdrive create spark-prod --connection-string="<Neon prod direct string>"
   ```

   | Placeholder in `wrangler.jsonc`  | Replace with                      |
   | -------------------------------- | --------------------------------- |
   | `PLACEHOLDER_DEV_HYPERDRIVE_ID`  | the id of the `spark-dev` config  |
   | `PLACEHOLDER_PROD_HYPERDRIVE_ID` | the id of the `spark-prod` config |

   `local-only-not-a-real-hyperdrive-id` stays: only local dev uses it.

3. **Cloudflare API token.** Dashboard → My Profile → API Tokens → Create Token → _Edit Cloudflare Workers_ template, limited to your account. Add Hyperdrive _Read_ if a deploy reports it cannot read the Hyperdrive config.
4. **Sentry.** Create two projects, one for the Worker (platform _Cloudflare Workers_) and one for the dashboard (_React_). Each project's DSN is under Settings → Client Keys (DSN).
5. **GitHub environments.** Repo → Settings → Environments. Create `dev` and `production`. On `production`, turn on **Required reviewers** (yourself) and, under **Deployment branches and tags**, allow branch `main` and tags `v*`.
6. Add the secrets and variables below, then the Worker secrets.
7. Set up the uptime monitor.

## Secrets and variables

GitHub (Repo → Settings → Secrets and variables → Actions, or the environment's page for environment-scoped ones):

| Name                    | Kind     | Where                                         | Get it from                                                                                   |
| ----------------------- | -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | secret   | repository                                    | step 3                                                                                        |
| `CLOUDFLARE_ACCOUNT_ID` | secret   | repository                                    | Cloudflare dashboard → Workers & Pages → Account ID                                           |
| `DATABASE_URL`          | secret   | environment `dev`, and again in `production`  | Neon direct connection string for that database; `db:migrate` runs with it before each deploy |
| `VITE_SENTRY_DSN`       | variable | environment `dev` and `production`            | the React project's DSN (public by design); baked into the dashboard build                    |
| `HEALTH_URL`            | variable | environment `dev` and `production` (optional) | e.g. `https://spark-dev.<subdomain>.workers.dev/api/health`; CI checks it after deploying     |

Worker secrets (stored in Cloudflare, per environment):

| Name         | Set with                                                                                  | Get it from              |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------ |
| `SENTRY_DSN` | `cd apps/server && npx wrangler secret put SENTRY_DSN --env dev` (and `--env production`) | the Worker project's DSN |

`SPARK_ENV` is a plain var already in `wrangler.jsonc`.

## Sentry and Memory content

Both SDKs start only when a DSN is configured. Neither sends request bodies, headers, cookies, query strings (search queries describe Memories), user info or breadcrumb text. Both then pass every event and breadcrumb through one allowlist, `sentryScrubbing` from `@spark/core/sentry` (tested in `packages/core/tests/sentry.test.ts`). What it keeps: ids, time, level, environment, release, the request method and URL path, exception types and stack frame locations, tags, and runtime/os names. Messages and exception values are replaced with the exception type or `[redacted]`.

## Uptime monitor

This is a free external service; nothing in the repo runs it. Use the [UptimeRobot](https://uptimerobot.com) free plan (or [Better Stack](https://betterstack.com/uptime) free; check each one's current limits on its pricing page):

- Monitor type: HTTP(s), URL `https://<prod host>/api/health`, every **15 minutes**.
- Alert when the status is not 200. `/api/health` returns 503 with `"db": "unreachable"` when the Worker cannot reach Neon through Hyperdrive. The check runs `select now()`, which Hyperdrive never serves from its cache, so a 200 means Neon answered.
- Alert contact: your email.

Every check wakes Neon, and Neon Free only scales to zero after 5 minutes idle. A 5-minute check would keep prod awake all month, which is more than the free 100 CU-hours at the smallest compute size. Every 15 minutes keeps it to about a third of the month.

## Migrations

`pnpm db:generate` writes a migration from `packages/db/lib/schema.ts`; `pnpm --filter @spark/db exec drizzle-kit generate --custom --name=<name>` makes an empty one for hand-written SQL. `pnpm db:migrate` applies pending migrations to `DATABASE_URL`. CI migrates dev and prod before deploying the Worker, so every migration must keep the live Worker working (add first, remove in a later release).

Drizzle is pinned to `drizzle-orm` 0.45.4 and `drizzle-kit` 0.31.11, the current stable line on npm. 1.0 is still a release candidate.
