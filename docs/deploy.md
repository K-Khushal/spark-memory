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

   **R2 (Memory files).** Create the buckets `wrangler.jsonc` names, an S3 API token for presigned URLs, and the CORS rule browsers need to upload straight to R2:

   ```sh
   npx wrangler r2 bucket create spark-files-dev
   npx wrangler r2 bucket create spark-files-prod
   npx wrangler r2 bucket cors set spark-files-dev  --file r2-cors.json   # then the same for spark-files-prod
   ```

   with `r2-cors.json` allowing only that environment's origin:

   ```json
   {
     "rules": [
       {
         "allowed": {
           "origins": ["https://<host>"],
           "methods": ["PUT", "GET"],
           "headers": ["content-type", "cache-control"]
         },
         "maxAgeSeconds": 3600
       }
     ]
   }
   ```

   Then Dashboard → R2 → Manage API tokens → Create API token, _Object Read & Write_, limited to that environment's bucket: its Access Key ID and Secret Access Key become the `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` Worker secrets below. Presigned URLs only work on the S3 endpoint (`<account id>.r2.cloudflarestorage.com`), never on a custom domain. Keep the buckets private (no public access, no r2.dev URL).

   **Queues and Workers AI (Indexing, accounts).** Create each environment's four queues (the names in `wrangler.jsonc`); Workers AI needs nothing but the `ai` binding already there:

   ```sh
   for env in dev prod; do
     npx wrangler queues create spark-index-$env
     npx wrangler queues create spark-reindex-$env
     npx wrangler queues create spark-index-failed-$env
     npx wrangler queues create spark-account-$env
   done
   ```

   **Gemini (optional, paid tier only).** Create the API key in a Google Cloud project with an active billing account, never a free-tier one (ADR-0005: free-tier content is used for training and read by reviewers, and the API cannot tell the tiers apart). Put it in `GEMINI_API_KEY`, then set `GEMINI_PAID_TIER` to `"true"` in that environment's vars. Until both are set, Gemini stays out of the chain and only Gemma 4 indexes.

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

Set each with `cd apps/server && npx wrangler secret put <NAME> --env dev`, then again with `--env production`. Use different values per environment.

| Name                   | Required | Get it from                                                                                                                                        |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`           | no       | the Worker project's DSN                                                                                                                           |
| `BETTER_AUTH_SECRET`   | yes      | `openssl rand -base64 32`; signs session cookies, so changing it signs everyone out                                                                |
| `TURNSTILE_SECRET_KEY` | yes      | Cloudflare dashboard → Turnstile → Add widget (mode _Managed_, hostname the Worker's host) → Secret key                                            |
| `RESEND_API_KEY`       | yes      | [resend.com](https://resend.com) → API Keys, _Sending access_ only                                                                                 |
| `GOOGLE_CLIENT_ID`     | no       | Google Cloud console → APIs & Services → Credentials → OAuth client ID (_Web application_), redirect URI `https://<host>/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | no       | the same OAuth client                                                                                                                              |
| `GITHUB_CLIENT_ID`     | no       | GitHub → Settings → Developer settings → OAuth Apps → New, callback URL `https://<host>/api/auth/callback/github`                                  |
| `GITHUB_CLIENT_SECRET` | no       | the same OAuth App                                                                                                                                 |
| `R2_ACCOUNT_ID`        | yes      | Cloudflare dashboard → R2 → Account ID (the same as `CLOUDFLARE_ACCOUNT_ID`)                                                                       |
| `R2_ACCESS_KEY_ID`     | yes      | the R2 API token from step 2, for this environment's bucket                                                                                        |
| `R2_SECRET_ACCESS_KEY` | yes      | the same R2 API token                                                                                                                              |
| `GEMINI_API_KEY`       | no       | Google AI Studio → API keys, in a Cloud project with billing on (step 2, Gemini); used only with `GEMINI_PAID_TIER` set to `"true"`                |

A social provider turns on only when both its client id and secret are set; otherwise its button is hidden.

## Memory files

Image files live in R2 (ADR-0003), one bucket per environment, under `users/<user id>/<memory id>/original` and `/thumbnail`. Keys are chosen by the Worker; nothing a person sends becomes part of a key. Browsers upload and download directly with presigned URLs (`apps/server/src/files.ts`), so file bytes never pass through the Worker:

- **Upload**: `POST /api/memories/images` creates the Memory within the Free allowance (25 MB a file, 1 GB in all, checked again here under a per-person lock) and answers with a PUT URL per file, valid 15 minutes, signed for that key, its exact `content-type`, `content-length` and `cache-control`. `POST /api/memories/:id/stored` then checks each object's size and type with the bucket binding before the Memory shows; an object that does not match is deleted.
- **Download**: every Memory answer carries GET URLs signed at the start of the hour for two hours, so the same URL repeats within the hour and the browser caches the file (`private`, never in a shared cache). API answers themselves are `Cache-Control: private, no-store`.
- **Delete**: deleting a Memory (after its Undo window) deletes its objects, then its row. Account deletion (#28) must do the same for every Memory.
- **Unfinished uploads**: a Memory whose files never arrived stays off the wall, counts against storage for 24 hours, and is then removed with any objects by the hourly cron (`triggers` in `wrangler.jsonc`, `src/sweep.ts`).
- **What is kept**: the original file byte for byte, metadata included, since only its owner can read it. HEIC is converted to JPEG in the browser, which keeps no EXIF. The browser also stores the SHA-256 of the kept file (for duplicate detection later; the server does not recompute it) and a ThumbHash placeholder.

Locally, without R2 credentials, Miniflare simulates the bucket in `.wrangler/state` and the presigned URLs point at `/api/local-files/*` on the local Worker, HMAC-signed the same way (method, key, expiry, type and size). That route exists only when `SPARK_ENV` is `local`, on a local host, without R2 credentials. Log lines carry counts only: never keys, file names or content.

Plain vars in `wrangler.jsonc`, per environment:

| Var                  | Value                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPARK_ENV`          | already set                                                                                                                                                                                                                                                                                    |
| `TURNSTILE_SITE_KEY` | the Turnstile widget's site key (public), in place of `PLACEHOLDER_DEV_TURNSTILE_SITE_KEY` / `PLACEHOLDER_PROD_TURNSTILE_SITE_KEY`; deploys fail until set                                                                                                                                     |
| `EMAIL_FROM`         | `Spark <onboarding@resend.dev>` until a domain is verified in Resend (it then only delivers to the Resend account's own address); then `Spark <sign-in@<domain>>`                                                                                                                              |
| `BETTER_AUTH_URL`    | the public https origin, e.g. `https://spark-dev.<subdomain>.workers.dev`, in place of `PLACEHOLDER_DEV_BETTER_AUTH_URL` / `PLACEHOLDER_PROD_BETTER_AUTH_URL`. Required: outside local, auth refuses to start without an https origin, and cookies are always `Secure`. Deploys fail until set |
| `GEMINI_PAID_TIER`   | `"false"` until `GEMINI_API_KEY` belongs to a Cloud project with active billing, then `"true"`; Gemini is never called otherwise (ADR-0005)                                                                                                                                                    |

Locally, `wrangler.jsonc`'s top level carries a throwaway `BETTER_AUTH_SECRET` and Cloudflare's always-pass [Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/). Without `RESEND_API_KEY`, sign-in codes are not emailed: the local Worker keeps the latest code per address and returns it from `GET /api/dev/sign-in-code?email=…`. That route exists only when `SPARK_ENV` is `local` and Resend is not configured.

## Indexing

After Capture (text on create, an image once its files are stored) the Worker sends the Memory to a queue; its own consumer Indexes it (`apps/server/src/indexing.ts`, `@spark/indexing`):

- **Queues.** Cloudflare Queues has no priorities, so `spark-index-*` takes fresh Captures, Retry and AI opt-out switched off, and `spark-reindex-*` takes edited text, one consumer at a time. A failed attempt retries the message after 30 s, then 60 s; the third failure sets the Memory Failed (`unavailable`). Messages the platform gives up on land in `spark-index-failed-*`, whose consumer sets Failed too (only if that run is still current). The hourly cron re-sends Memories stuck Indexing for over an hour, unless the budget is spent. Every message is idempotent: it names the Memory's `index_run` (bumped by an edit, Retry or AI opt-out), a message for an older run does nothing, and every write requires the run unchanged. A delivery takes a 5-minute lease on the run (renewed before each provider call; each call times out after 60 s), so a duplicate delivered at the same time skips instead of paying for the same AI call; a crashed consumer's lease expires on its own, and a new run (an edit, Retry or opt-in) is never held up by an older run's lease.
- **Providers.** Gemma 4 on Workers AI, then Gemini Flash-Lite on the paid tier (model ids, prices and order in `packages/core/lib/indexing.ts`). Images go to the model as bytes read through the R2 binding, never as URLs.
- **AI opt-out.** No provider call, ever: the consumer checks it after loading and again before every provider call, and switching it on starts a new run (so nothing in flight can write) and deletes what Indexing found.
- **Budget.** Every call's tokens and cost go to `ai_call` (per Memory and person) and `spend_day` (per UTC day and provider, added to atomically). The daily budget is **$1** by default (`INDEXING.dailyBudgetMicros` in `packages/core/lib/indexing.ts`; change it there). Past it, background messages are re-sent with a delay (to the next UTC day, at most 12 hours at a time, though Queues allows 24); fresh Captures still index, and the hourly sweep still re-sends fresh work whose message was lost. A person's Retry or opt-in goes first in line once a Memory a day, then to the background, so it cannot bypass the budget without limit. A Workers AI call that times out is still billed, so it is recorded at an estimated cost (its prompt, and every output token it may use), marked `estimated` in `ai_call`. In-flight calls can overshoot the limit by a few calls.
- **Locally**, Miniflare runs the queues and `INDEXING_PROVIDER: "fake"` Indexes without keys or network. Content containing `fake:fail` gets output that is never valid, so it shows Failed at once.
- **Logs** carry outcomes only, never content, prompts or model output.

## Account: sessions, export, deletion

Settings (`/settings`) lists signed-in devices, exports the Library and deletes the account (`apps/server/src/account.ts`, `account-jobs.ts`; `@spark/db` → `openAccount`, `accountJobs`).

- **Sessions** are read and revoked straight from the `session` table; the browser sees a device name and a short hash, never a session id or token. No Better Auth route is added to the allowlist.
- **Cross-site requests.** Every cookie-authenticated change outside `/api/auth` (Memories and account routes) must carry an `Origin` equal to `BETTER_AUTH_URL`'s origin (`src/origin.ts`); anything else is 403. A future extension or app origin has to be added there.
- **Export** runs on `spark-account-*`: one message builds a stored (uncompressed) ZIP, `memories.json` plus every original file, streamed from R2 into an R2 multipart upload in equal 8 MiB parts, so memory stays flat. It is leased (a duplicate message skips), retried twice, then Failed. The download goes through `/api/account/export/download`, which redirects to a freshly signed URL; the ZIP is removed 24 hours after it is ready, and a new export can start an hour after the last. A ZIP that is let go of (expired, or replaced by a new export) is recorded in `object_removal` in the same transaction, and the hourly sweep removes it from storage before forgetting it, in batches, up to about 20 seconds a run (the rest goes next run). **On Workers Free** the 10 ms CPU limit (the CRC of every byte is computed in JavaScript) and the 1,000-calls-per-invocation limit for R2 cap exports at small Libraries; Workers Paid ($5, PLAN.md §2) lifts both (a 15-minute queue wall time and 10,000 calls).
- **Deletion** is confirmed by typing the account's address (ADR-0007: there is no password to ask for). It ends every session and blocks sign-in at once: a Better Auth hook refuses new sessions, checks again under the per-owner lock once a session exists (closing the race with the request), and `requireUser` refuses any session of an account being deleted, then the account job removes every object under `users/<id>/`, every Memory and its rows, and anonymises `ai_call` (the money was spent; admin totals stay true); an AI call that finishes later is recorded without its owner, decided under the same lock. It finishes 20 minutes later with a last pass and the user row (sessions, sign-in accounts, the export and the request go with it), so an upload signed before the request (its URL lives 15 minutes) cannot land after the last pass. The hourly cron re-sends unfinished deletions and lost export messages.

## Sign-in

Better Auth (ADR-0007) runs in the Worker at `/api/auth/*`, with users, sessions and email codes in Postgres. Email codes are 6 digits, stored hashed, valid 5 minutes, 3 tries. Codes are sent through Resend's REST API without delaying the response (`waitUntil`). Turnstile guards sending a code and starting a social sign-in, since both can create a user. Codes are only ever sent for signing in. Only the routes Spark uses are reachable under `/api/auth` (session, sign out, send and check a code, social sign-in and its callback); every password, reset and account-editing route Better Auth ships answers 404. Better Auth logs through a redacting logger: plain-word messages only, never arguments, and database failures by category. Auth endpoints are rate limited per IP (`cf-connecting-ip`) in Postgres (`rate_limit` table): 60 a minute overall, 3 code sends, 10 code checks and 10 social starts. Nothing logs addresses, codes, tokens or session ids.

## Sentry and Memory content

Both SDKs start only when a DSN is configured. Neither sends request bodies, headers, cookies, query strings (search queries describe Memories), user info or breadcrumb text. Both then pass every event and breadcrumb through one allowlist, `sentryScrubbing` from `@spark/core/sentry` (tested in `packages/core/tests/sentry.test.ts`). What it keeps: ids, time, level, environment, release, the request method and URL path, exception types (only if they look like identifiers, otherwise `Error`), stack frame locations, and tags. Contexts are dropped. Messages and exception values are replaced with the exception type or `[redacted]`.

## Uptime monitor

This is a free external service; nothing in the repo runs it. Use the [UptimeRobot](https://uptimerobot.com) free plan (or [Better Stack](https://betterstack.com/uptime) free; check each one's current limits on its pricing page):

- Monitor type: HTTP(s), URL `https://<prod host>/api/health`, every **15 minutes**.
- Alert when the status is not 200. `/api/health` returns 503 with `"db": "unreachable"` when the Worker cannot reach Neon through Hyperdrive. The check runs `select now()`, which Hyperdrive never serves from its cache, so a 200 means Neon answered.
- Alert contact: your email.

Every check wakes Neon, and Neon Free only scales to zero after 5 minutes idle. A 5-minute check would keep prod awake all month, which is more than the free 100 CU-hours at the smallest compute size. Every 15 minutes keeps it to about a third of the month.

## Migrations

`pnpm db:generate` writes a migration from `packages/db/lib/schema.ts`; `pnpm --filter @spark/db exec drizzle-kit generate --custom --name=<name>` makes an empty one for hand-written SQL. `pnpm db:migrate` applies pending migrations to `DATABASE_URL`. CI migrates dev and prod before deploying the Worker, so every migration must keep the live Worker working (add first, remove in a later release).

Drizzle is pinned to `drizzle-orm` 0.45.4 and `drizzle-kit` 0.31.11, the current stable line on npm. 1.0 is still a release candidate.
