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
