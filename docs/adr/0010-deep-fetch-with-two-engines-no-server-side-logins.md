# Deep fetch: two engines, temporary media, no server-side logins

When normal Capture and Indexing bring back too little (no readable text, no image, a login wall, a video without a transcript), a Deep fetch runs once per Memory, with retries.

- **Cloudflare Browser Rendering** loads pages that need JavaScript and takes readable text and a screenshot.
- **A fetcher container on Google Cloud Run** (yt-dlp, ffmpeg, a headless browser) handles video and audio. It downloads the media temporarily, sends audio to Gemini for a timestamped transcript and pulls a few keyframes for Visual vectors. The file is deleted when the job ends.

Third-party video stays Reference only: we keep the thumbnail, transcript and vectors, not the media.

Spark never logs into platforms on the server, not with accounts we own, burner accounts or uploaded user cookies. That is a security liability, breaks platform terms and gets accounts banned. Content behind login walls (such as Instagram reels) is fetched by the user's own browser through the extension and uploaded as a copy the user provided.

## Consequences

- Both engines sit behind one Deep fetch interface, so either can be replaced.
- Free tiers bound the work (Browser Rendering is 10 minutes a day on the free plan). When a month's Cloud Run free tier runs out, Deep fetches queue for the next month instead of costing money.

## Amendment (November 2026, #21)

The first build returns a timestamped transcript for video and a text, metadata and screenshot for pages. **Keyframes for Visual vectors are not built yet**: they need the Indexing pipeline to embed images that are not the Memory's own, which is a separate change, and the transcript is what makes a video findable. The container carries no headless browser either: the audio path needs only yt-dlp (with Node as its JavaScript runtime) and ffmpeg. Limits, free tiers and what each number rests on are in [docs/research/deep-fetch.md](../research/deep-fetch.md).

Thin means **no Preserved text** (a login wall, an app shell) or a video without a transcript. A missing image alone never triggers a Deep fetch (orchestrator decision, November 2026).

## Amendment, 12 November 2026: the user-provided copy (#20)

An Instagram reel's copy is uploaded straight to R2 by the extension, in the person's own session, through the existing presigned PUT flow (`memory_copy`, not `memory_file`, so an unfinished copy never hides the reel or counts as an abandoned upload). Indexing reads it once: Gemini on the paid tier writes the transcript, the browser's frames become Visual vectors. The video and frames are then deleted, when Indexing ends for good (done or Failed), by the hourly sweep if that is missed, and after 24 hours whatever happened. The reel stays Reference only. The transcript is a model's, so AI opt-out removes it and refuses any later copy. This is the client-side half of the Deep fetch path; it does not touch the Deep fetch interface (#21). A reel is never queued for Deep fetch, with a copy or without: it is behind a login wall, which no engine crosses, so `saveGathered` leaves it out of the "thin" rule and the copy is its only route to a transcript.
