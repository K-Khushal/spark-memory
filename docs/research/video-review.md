# Video Memory review (#19)

Scope: new video Capture, public-caption gathering, transcript Passage vectors,
keyword timestamp anchors, and the Memory detail transcript reader. Baseline:
`b9d2b0d` (origin/main at assignment). This implementation agent performed the
source review itself; no nested agents were started. Independent factory review
is still required before merge.

## Standards

Read CLAUDE.md, GLOSSARY.md, DESIGN.md, packages/README.md and ADR-0004/0005/0010.
Source/third-party calls use publicFetch with deadlines and per-hop permission.
Every persisted result goes through the existing owner/generation/run fence;
no network call holds a transaction. Only the existing paid Gemini adapter may
describe video text, with AI opt-out and budget checks unchanged. The public
caption track never goes to Jina. Player origin and video IDs are fixed/validated.

Fixed during review: paragraph boundaries could exhaust the Passage count before
the transcript ended; video windows now cover the entire bounded transcript.
Keyword anchors now count emoji as two UTF-16 units, matching client offsets.

## Spec

The cook brief explicitly allows public captions and metadata fallback. This
supersedes the issue's original request for Gemini-generated transcripts.
Missing/unknown-duration/over-60-minute transcripts are marked and metadata stays
searchable. Third-party video stays Reference Only. YouTube URL forms dedupe
without timestamps; the original Source URL retains the captured moment.

Deferred to existing #21: temporary media downloads, non-YouTube transcription,
keyframes and Deep fetch retries. No platform login or bypass was introduced.
No paid-provider live call was made. Existing pre-feature link rows are not
rewritten or merged by the migration.

## Interface review

Applied web-design-guidelines from its current upstream command.md to the reader,
why-chip, and detail flow: native buttons/links, named iframe, visible token focus
rings, literal React text, no autoplay, no new motion, wrapped long text, flexible
footer controls. The player loads only after an explicit Play or timestamp click.
The large transcript uses content-visibility to avoid laying out every offscreen
row. The existing modal/press motion follows DESIGN.md; no motion was added.

The better-interface orchestration skill's six owning skills
(better-accessibility/layout/writing/typography/colors/ui) are unavailable in this
checkout; those standalone skill reviews are **Not reviewed**, not represented
as a holistic approval. The owning project's DESIGN.md and the web guidelines
were checked directly.

Break-ui harness: development-only `/prototypes?video=1`, with Demo, Worst Case,
Empty, One and 1,000 Rows. It renders the production VideoReader. Worst Case has
Hindi, Arabic, emoji, literal HTML and a long unbreakable word. Automated layout
checks cover 1440, 390 and 320px, plus 200% root text size and RTL in dark mode.
The actual browser tests and screenshot results are recorded in the PR.
