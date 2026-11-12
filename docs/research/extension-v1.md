# Extension v1 research (#17)

Checked **2026-11-12 UTC** against primary docs, release metadata and source. Recommendations below are implementation conclusions, not browser acceptance-test results. Scope: Chrome MV3; Firefox behavior needs separate validation.

## Framework maintenance

| Candidate | Dated evidence | Conclusion for v1 |
| --- | --- | --- |
| **WXT** | Latest GitHub release [0.21.5, 2026-10-26](https://github.com/wxt-dev/wxt/releases/tag/wxt-v0.21.5), with features and fixes. | Retain the planned WXT + React stack; recent maintenance and integrated extension tooling. |
| Plasmo | Latest GitHub release [0.90.5, 2025-05-17](https://github.com/PlasmoHQ/plasmo/releases/tag/v0.90.5), nearly 18 months ago. | Higher maintenance risk for a new app; Better Auth's Plasmo example does not require choosing Plasmo. |
| CRXJS | Latest GitHub release [vite-plugin 2.7.0, 2026-06-19](https://github.com/crxjs/chrome-extension-tools/releases/tag/vite-plugin-v2.7.0); [2.6.1](https://github.com/crxjs/chrome-extension-tools/releases/tag/vite-plugin-v2.6.1) adds Vite 8 compatibility tests. | Maintained alternative, not abandoned; a bundler plugin with more assembly needed. |

[WXT's comparison](https://wxt.dev/guide/resources/compare) lists broader browser support, ZIP generation and automated publishing for WXT. Its maintenance ratings are a competitor's assessment, not independent evidence; the CRXJS releases above demonstrate renewed work. These are GitHub release observations, not assertions about every npm dist-tag.

## Better Auth 1.7.19: share the dashboard cookie

The repo pins Better Auth **1.7.19** (`packages/auth/package.json`). Its [versioned client source](https://github.com/better-auth/better-auth/blob/v1.7.19/packages/better-auth/src/client/config.ts) defaults to `credentials: "include"` when supported; keep that explicit in extension client/API configuration. The [official extension guide](https://better-auth.com/docs/guides/browser-extension-guide) requires backend host permissions and a trusted extension origin; its Plasmo packaging is incidental.

Recommended contract:

1. Pin one HTTPS dashboard/API origin in the build, e.g. `https://sparkmemory.xyz`; set manifest `host_permissions: ["https://sparkmemory.xyz/*"]`. Keep local-development hosts in development builds only. Do not accept an arbitrary backend URL from a page or message.
2. Pin the extension ID using a manifest public `key` for unpacked builds; verify it matches the intended production ID ([Chrome key docs](https://developer.chrome.com/docs/extensions/reference/manifest/key)). Configure exactly `chrome-extension://<32-character-id>` in server `trustedOrigins`, application mutation-origin checks and any credentialed CORS allowlist. Never `chrome-extension://*` or reflected arbitrary origins. [Better Auth guidance](https://better-auth.com/docs/guides/browser-extension-guide) explicitly warns against trusting all extensions; [1.7.19 origin middleware](https://github.com/better-auth/better-auth/blob/v1.7.19/packages/better-auth/src/api/middlewares/origin-check.ts) implements origin/CSRF checks. Preserve those protections.
3. Sign in through the normal dashboard in a top-level tab. On popup opening or explicit retry, fetch `/api/auth/get-session` with credentials, then send Capture requests with the same cookie. On missing/expired session, show sign-in; do not introduce a bearer-token handoff, token storage, cookie copying or `chrome.cookies` access.
4. Perform authenticated requests from the popup or extension service worker. [Chrome network docs](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) grant host-permitted cross-origin requests there; content scripts still make requests on behalf of the page origin. Content scripts should extract and message data, not authenticate.

[Chrome cookie docs](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#partitioning-and-samesite-behavior) explain that host-permitted extension requests can send even `SameSite=Strict` site cookies. This permits reusing the site's HttpOnly session cookie without reading it in JavaScript; do not weaken cookies to `SameSite=None` solely for this design. The same docs qualify the same-site exception when third-party cookies are blocked: validate supported Chrome settings rather than promise universal behavior.

Shared-checkout observation: `packages/auth/lib/auth.ts` already accepts `extensionOrigin`; `apps/server/src/origin.ts` validates an exact Chrome ID and provides mutation-origin/CORS middleware. Reuse those boundaries and verify middleware mounting/configuration; the older deployment note saying extension origins are future work may be stale during parallel implementation.

## Defuddle: local DOM parsing only

Use the browser bundle (`import Defuddle from "defuddle"`) against a cloned current document, preserving the original page URL explicitly:

```ts
const result = new Defuddle(document.cloneNode(true) as Document, {
  url: document.URL,
  useAsync: false,
}).parse();
```

The [README](https://github.com/kepano/defuddle#usage) documents browser parsing and `useAsync` (default **true**). The repo currently resolves **0.19.6**; its [versioned parser source](https://github.com/kepano/defuddle/blob/0.19.6/src/defuddle.ts) separates synchronous `parse()` from async extractors and guards those with `useAsync !== false`. Source also shows preferred async extractors can run **before** local parsing, so the README's description of external calls only as an empty-content fallback is incomplete. Avoid `parseAsync()`, `fetchAsyncVariables()`, the Node wrapper and CLI for v1 capture.

Do not mount extracted HTML in the live page or fetch discovered images, embeds, favicons or transcript URLs as part of extraction. An external URL in returned metadata is a reference, not permission to fetch it. This is the implementation rule needed alongside synchronous parsing to keep capture local; existing network activity from the page itself is outside that guarantee. Verify extraction adds **zero** requests on article, empty SPA and YouTube/X fixtures, including when parsing fails. Missing text should fall back to available metadata/selection/URL, never an external extraction API.

## Acceptance checks still required

- Real unpacked Chrome: dashboard login → popup session → authenticated save; logout/expiry → sign-in state. Repeat with third-party-cookie blocking enabled.
- Reject an unconfigured extension origin and requests to an unpinned backend; check credentialed mutation/preflight handling without wildcard origins.
- Observe extraction network traffic with empty/dynamic pages and async-capable sites; assert no extraction-initiated requests or page mutation. Research alone does not establish these runtime guarantees.
