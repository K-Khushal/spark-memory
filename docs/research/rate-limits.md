# Per-user rate limits: Cloudflare's Rate Limiting binding (#27)

Checked 13 November 2026 against Cloudflare's [Rate Limiting page](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (updated 12 November 2026). **Re-check before relying on any number.**

## What it is

- A Workers binding, `ratelimits` in wrangler config (wrangler 4.36 or later; this repo has 4.159). Each binding has a `namespace_id` (an integer, as a string, unique in the account) and `simple: { limit, period }`. **`period` is 10 or 60 seconds, nothing else.** The Worker calls `await env.X.limit({ key })` and gets `{ success }`.
- Counts are **per Cloudflare location and approximate**: eventually consistent, and a burst can pass more than `limit` before the count syncs. For a strict, global limit Cloudflare points to Durable Objects.
- The page lists **no plan restriction and no price** for the binding, and neither Workers pricing nor Workers limits mention it. It does not say "available on Free" in so many words; a third-party summary says it is GA on Free and Paid. Treat Free availability as likely but confirm it with the first deploy (`wrangler deploy --dry-run` accepts the config; a real deploy would refuse it on a plan without it).
- It does not return the time left in the window, so a 429's `Retry-After` is the period (60 s), not an exact wait.
- Not visible in the dashboard; 429s show in Workers Logs.

## What Spark does

- Six bindings per environment (`CAPTURE_LIMITER` 60 a minute, `SEARCH_LIMITER` 600, `EDIT_LIMITER` 60 for every other Library write, `OPT_OUT_LIMITER` 10 for the AI opt-out toggle, `IMAGE_SEARCH_LIMITER` 30 for search by image), keyed by the **signed-in user's id** after auth (Cloudflare advises against IP keys), and `TOKEN_LIMITER` 60 for the anonymous OAuth token endpoint, the one binding keyed by network address because it has no person. Namespaces 1001 to 1006 locally, 2001 to 2006 dev, 3001 to 3006 production.
- **Capture**: 60 a minute across the four Capture routes (text, link, image, PDF) and the screenshot upload. A file Capture is two or three calls, and the daily Capture count (100) is the real limit.
- **Search**: 600 a minute across `POST /api/search` and More Like This. Instant search runs on every keystroke, so a fast typist is around 10 a second at worst; this leaves room for held keys and repeated searches.
- A binding that is not set (local `wrangler dev`, tests) does not limit. Tests fake the binding at its interface.
- Over the limit: **429** `{ error: "rate_limited" }` with `Retry-After: 60`.
- The Durable-Object-free choice is deliberate: the approximate, per-location count only has to stop floods and runaway clients. The limits that must be exact (Captures a day, Deep fetches a day, storage) are counted in Postgres in one atomic statement (`usage_day`, `memory_file`).

## Not done

- Sign-in and other unauthenticated routes: no per-IP limit was added here (sign-in has Turnstile).
- Weighted calls (`delta`, local wrangler 4.157+): Full-mode search could weigh more than instant. Not needed yet.
