# Browser extension v1

Chrome and Edge, Manifest V3, WXT 0.21.5. Framework/auth research is in
[extension-v1.md](research/extension-v1.md). Firefox validation belongs to #18.

## Build and load locally

1. Start the normal local stack (`pnpm dev`). If using another database/port,
   set `DATABASE_URL` for migrations and
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` for Wrangler.
2. Build: `WXT_API_ORIGIN=http://localhost:5173 pnpm --filter @spark/extension build`.
3. Open `chrome://extensions` (Edge: `edge://extensions`), enable Developer Mode,
   Load Unpacked, choose `apps/extension/.output/chrome-mv3`.
4. Sign in on the dashboard. Pin Spark to the toolbar. Click it on a web page,
   or press **Alt+Shift+S** (editable in the browser's extension shortcuts page).
   The popup Captures immediately; add an optional Capture Note afterward.

Local builds use a public development key for a stable ID
`nibnigchkjjmpoolklhjgmlkancbmncm`, pinned in local Wrangler vars. This key
contains no secret. Dev/production intentionally trust no extension until
`EXTENSION_ORIGIN` is configured with the released extension's exact origin.
Never set a wildcard. Do not deploy the local development ID as the store ID.

## Security and lifecycle

- Build-time `WXT_API_ORIGIN` fixes the one API host. HTTPS is required outside
  localhost. Only `activeTab`, `storage`, `scripting`, `alarms`, and that host
  are requested. `scripting` injects the bundled extractor after the gesture;
  `alarms` retries the outbox while the popup is closed. No broad page hosts,
  cookies permission, external messages, passwords or bearer tokens.
- Better Auth **1.7.19** reuses the dashboard's HttpOnly cookie through
  credentialed background requests. Sign-in always opens the dashboard.
  Session expiration, sign-out and account deletion revoke access through the
  existing session/deletion checks. Cookies retain their existing SameSite
  settings. Only the Memory API and `/me` opt into the pinned extension
  origin; account and admin routes require the dashboard origin.
- Defuddle runs on a cloned DOM, synchronously with `useAsync: false`. No
  page content goes to another extraction service. Metadata is bounded;
  HTML is converted to text, never mounted in the page. Restricted browser
  pages and Spark itself cannot be Captured.
- JPEG visible-area screenshots are optional (maximum 400 KB). A tab switch
  during capture discards the screenshot. The Source/text still save when
  screenshots are unavailable or the storage allowance refuses the copy.
  Signed downloads: `GET /api/memories/:id/screenshot`. Account exports and
  deletion include screenshot files through the existing file lifecycle.
- An outbox holds at most ten retryable Captures for the current owner,
  including page text and screenshot,
  in **local**, trusted-extension-only storage, never sync. It stores an
  account ID, not credentials. Retries run every minute while rows exist,
  at startup when queued, or via Try Again. An empty outbox has no alarm and
  never refreshes a session in the background. Capturing offline
  requires having signed in successfully through this extension before.
  Outbox requests bind to that account; switching accounts cannot send old
  Captures to a new Library. Once `/me` confirms a different account, the
  previous account's queued text and screenshots are removed. Discard Outbox
  appears only while rows exist and removes queued content. Uninstall
  clears extension storage. Account deletion prevents sending old entries;
  use Discard Outbox or uninstall to remove local copies.
- Non-retryable 4xx refusals remove the queued page and record a one-shot
  error notice, including refusals during an alarm. A 401 retains the Capture
  for sign-in and does not consume an undisplayed refusal notice. Refused or
  other-owner rows cannot prevent an online Capture from saving. A successful
  link with a retryable screenshot failure is retried with the same Capture ID.
- Failed injection, an extraction exception or no extraction answer omits
  `page` from the Capture, allowing the existing paste/server gathering path.
- Existing AI opt-out, Free allowance and Indexing policy apply. Client text
  skips server gathering. Resurfacing a link can fill missing readable text
  once, invalidating stale Indexing claims, without overwriting preserved text
  or changing an existing AI opt-out.

## Verification

Unit/API tests: `pnpm check` with a migrated real Postgres `DATABASE_URL`.
Use a throwaway `pgvector/pgvector:pg17` container on a random host port.

CI smoke builds the unpacked test extension and runs it with the dashboard
suite using headless Chromium's `--load-extension`. Run it alone locally:

```sh
WXT_E2E=1 WXT_API_ORIGIN=http://localhost:5173 pnpm --filter @spark/extension build
EXTENSION_E2E=1 pnpm --filter @spark/web exec playwright test e2e/extension.e2e.ts --workers=1
```

Set the database connection variables above for the e2e servers. For isolated
ports also set `SPARK_WEB_PORT`, `SPARK_API_PORT` and match `WXT_API_ORIGIN`.
The test-only `WXT_E2E=1` build adds `<all_urls>` because Playwright cannot
simulate the toolbar gesture's `activeTab` grant. It uses a real unpacked
extension, real dashboard sign-in, API and database; only the Source page is
an HTML fixture. **Never distribute this test build.** Local smoke skips
this test unless `EXTENSION_E2E=1`; CI sets it explicitly. Screenshots use the
Playwright artifact directory by default; set `EXTENSION_SCREENSHOTS_DIR` to
save them elsewhere. Rebuild normally afterward.

Manual release checks (real toolbar gesture, normal permissions):

- Capture an article, JSON-LD page, login-wall page visible to you, empty SPA,
  non-Latin title, and restricted `chrome://` page; verify Saved/Already in
  Your Library, text, screenshot, Capture Note, and keyboard focus.
- Go offline after one signed-in Capture, Capture another page, close popup,
  reconnect; verify one Memory. Repeat after browser restart.
- Sign out, sign in as someone else, confirm old outbox entries never appear
  there. Delete the original account; its queued requests must fail.
- Test with third-party cookies blocked, in Chrome and Edge. Review light/dark,
  320px popup width, 200% text zoom, 500-character RTL/CJK Capture Notes and
  reduced-motion settings. The popup has no animated transitions.

## Publish later

Do not publish as part of #17. The owner decides the Chrome Web Store account
and registration fee. Build with the real HTTPS API origin, obtain the store
listing's public key/ID, set `WXT_EXTENSION_KEY` when building unpacked release
candidates and pin the corresponding `EXTENSION_ORIGIN` on the server. Verify
session sharing using that ID. Run `pnpm --filter @spark/extension zip` with the
same build environment, review the ZIP manifest (no local/test host grants),
then upload manually to the owner's listing. Supply screenshots, privacy and
single-purpose/permission disclosures. Edge uses a separate listing and ID;
configure that deployment's exact origin before testing. One deployment trusts
one extension ID in v1; multi-store concurrent trust needs an explicit bounded
allowlist change. No wildcard or remote-loaded code.
