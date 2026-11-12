# Extension v2 review

Scope: Capture inputs, region overlay, existing popup confirmation, owner-bound
image outbox and exact extension origins. Base a806f0b.

## Standards review

The code-review Standards agent found two documented-standard violations and
one possible duplication smell:

- Toolbar completion said Saved instead of Captured: fixed.
- Separate popup/menu dispatch chains left stale toolbar feedback: fixed by
  one promise-returning dispatcher.
- Cancel uses the platform system font instead of self-hosted Instrument Sans:
  deferred. The injected page surface currently has only this native button.
  A follow-up should package the shared font for injected UI without exposing
  additional extension resources unnecessarily. Popup typography is unchanged.

## Spec review

The independent Spec agent found two selection defects:

- Truncated text-fragment context could split words: fixed by discarding the
  partial outer words; an actual fragment-navigation smoke step verifies
  scrolling to the selected passage.
- Context-menu frame identity was discarded: fixed, including frame Source
  preservation and an exact optional host request for cross-origin frames.

No further auth/upload/outbox defect or scope creep was found by that review.

## Interface and motion review

The better-interface skill was loaded. Its six owning domain skills are absent
from the installed catalog, so those domains are **Not reviewed** by that skill;
this is not a holistic approval. The available web-design-guidelines and
DESIGN.md were checked directly.

Fixed during gesture/interface review: Cancel pointerup could complete an old
keyboard selection; the pointerup handler excludes Cancel. A transformed border
scaled beyond the selected rectangle; the overlay now uses a borderless
translucent token colour. Keyboard arrows resize, Control/Command+Arrow moves,
Shift adjusts one pixel, Enter Captures, Escape and Cancel discard. Tab cycles
the selector and Cancel. Focus returns to the prior page control. Scroll/resize
cancels.

Review-animations: no timed animation was added. Pointer tracking maps directly
to the selected rectangle without React state, easing, inertia or transitions.
Reduced motion therefore has the same direct tracking behavior.

Break-ui verification uses the existing smoke fixture: narrow popup, 200% text,
RTL/CJK/emoji and a 500-character Capture Note. Light/dark screenshots at 1440
and 390 are written to the factory artifact directory. Empty and restricted
pages, empty selections, reverse/zero-area crops, failed extraction, offline
retries and account changes have unit/API coverage. The overlay's sole visible
label is bounded native text; no user content is rendered there. A dev toggle
was not added to production extension UI; the automated fixture is the
repeatable stress entry point.

## Release limits

Firefox store lint has zero errors; bundled Zod/React/Defuddle generate
eight eval/innerHTML warnings. Extraction still operates on a detached clone;
page HTML is never mounted as Spark UI. Real Firefox session sharing, permission
prompts, store publication and scalable Firefox runtime-origin provisioning
remain release follow-ups. No new issues were created, as the cook brief
requires follow-ups in the PR body.

## Round 1 fixes

S1 preserves the pre-existing fragment; S2 waits two animation frames after
overlay removal. S3 runs the merged search baseline without updating it.
S4 moves host requests to an explicit extension-page click and handles API
rejection and denial. S5 limits playback timestamps to video URLs and keeps the
latest Source when resurfacing a video. S6 makes IndexedDB writes insert-once;
S7 clears badges when their queued/error state resolves.

Regression coverage includes router fragments, the two-frame fence, permission
handoff/rejection/resumption, video duplicate identity/latest Source, immutable
image bytes and badge cleanup. Chromium smoke checks an actual cropped pixel
against the page and exercises the Grant Access page with a click.
