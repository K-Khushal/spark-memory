# Extension v1 review (#17)

Reviewed 12 November 2026 against issue #17, the cook brief, DESIGN.md,
GLOSSARY.md, CLAUDE.md, packages/README.md and ADRs 0006/0007/0010.
Base: `ffd8ecf`. Includes the inherited uncommitted changes.

## Standards

Independent Standards review found a discard race: direct storage removal could
be undone by an in-flight outbox write. Fixed by putting `clear` through the
same serial writer as add/flush; concurrency test covers it. Progress ellipses
were removed. Reviewer proposed Captured rather than Saved; the explicit brief
and issue prescribe Saved, so the confirmation retains that wording.

## Spec

Independent Spec review found:

- Long OG image URLs could reject the entire extraction: fixed by dropping
  overlong image metadata; failing-then-passing extraction regression test.
- HTTP 429/503 was treated as signed-out: fixed by using the cached account for
  retryable identity failures, just as for offline requests.
- Resurfacing a Reference Only link discarded newly readable client text:
  fixed by filling only missing text, checking deletion under the owner lock,
  and restarting the Indexing run so old work cannot overwrite the fill.
  Concurrent API Capture test verifies one Memory and preserved text.
- Instructions and screenshot evidence were missing during review: now supplied
  by docs/extension.md and the unpacked extension e2e artifacts.

Also probed concurrent screenshot uploads (one stored file, allowance rechecked
inside the owner lock, losing objects removed) and account switching (explicit
owner header checked against the authenticated account on every mutation).
Permanent outbox refusals are retained for discard without blocking later rows.

## Interface scope and coverage

Scope: the extension popup flow, React/WXT, native controls, shared UI tokens
and self-hosted fonts. No page toast or injected UI: confirmation is the popup's
live status. No animations; review-animations does not apply.

`better-interface` was loaded. Its six owning skills (`better-accessibility`,
`better-layout`, `better-writing`, `better-typography`, `better-colors`,
`better-ui`) are unavailable in this checkout, so their domain-specific review
is **Not reviewed**. The checks below are the separate Web Interface Guidelines
and break-ui review; this is not a claim of holistic better-interface approval.

| Check | Evidence | Result |
| --- | --- | --- |
| Web Interface Guidelines | Fresh upstream command.md; popup native label/textarea/buttons/links, focus-visible, live status, dir=auto | No outstanding code findings |
| Colors/type | UI THEMES/RADIUS/TYPE_SCALE; bundled Instrument Sans/Bricolage/Noto; light/dark screenshots | Uses DESIGN.md values |
| Motion | No transitions or animation | Reduced-motion has no motion to suppress |
| Confirmation | Real popup state in unpacked-extension e2e | Saved/duplicate and note edit pass |

## Break-ui

Rendered dynamic fields: confirmation (finite states), Capture Note (500 chars,
optional). Page titles, URLs, names and emails are deliberately not rendered
in this minimal popup. There is no unbounded list or numeric count.

The popup is fixed at its real 320px container, with a viewport max-width,
wrapping confirmation, and full-width resizable textarea. The break-ui catalog
was read; the relevant adversarial cases are a full-length mixed RTL/CJK note,
empty note, longest confirmation, keyboard focus and enlarged text. A dev-only
dataset toggle is not shipped. The automated e2e exercises the actual data boundary, offline queue/reconnect,
and light/dark at 1440/390. It also fills a 500-character Arabic/CJK/emoji note,
sets RTL and doubles text size at 320px, asserts no horizontal overflow, focuses
the note action and saves `t17-320-dark-worst.png`. Real toolbar/browser zoom
release checks remain in docs/extension.md. Unverified combinations remain
manual; no unavailable-skill approval is claimed.

## Deferred release checks

Chrome Web Store/Edge publication and fees remain the owner's decision;
Firefox is #18. Validate the normal toolbar activeTab gesture, third-party
cookie-blocking configurations and Edge store identity before release. The
Playwright test build has a test-only broad host grant, removed from release
builds. A separate in-page toast is deferred: v1 uses the brief's minimal popup
confirmation and avoids injecting another UI surface into arbitrary pages.
