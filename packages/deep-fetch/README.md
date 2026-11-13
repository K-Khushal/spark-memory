# @spark/deep-fetch

Deep fetch (GLOSSARY.md, ADR-0010): the heavier second attempt at a link or video that came back thin, behind one call with two swappable engines.

- `createDeepFetch({ page?, media? })`: one `DeepFetch`; a kind without an engine is not `available`.
- `cloudflareBrowser(...)` for pages that need JavaScript, `cloudRunFetcher(...)` for video and audio, `fakeEngine(...)` for tests and the local Worker.
- `createDeepFetchWorker({ store, ai, deepFetch, keepScreenshot })`: one job. Claims the Memory, honours the 20 a day, the engine's free tier and the AI budget, writes what came back or schedules the next attempt (1 hour, 24 hours, Failed).
- `@spark/deep-fetch/fetcher`: the container's HTTP handler (`createFetcher`), used by `apps/fetcher`.

Never logs in and never sends cookies. Research and limits: `docs/research/deep-fetch.md`.
