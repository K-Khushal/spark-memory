# apps/fetcher

The Deep fetch container (ADR-0010) for video and audio. It runs on Google Cloud Run's free tier and never logs into platforms or sends cookies.

`POST /fetch` with `Authorization: Bearer <FETCHER_TOKEN>` and `{ "url", "maxMinutes" }`:

1. Only a public YouTube or Vimeo video page (`isVideoUrl`) whose host resolves to public addresses only is fetched. Private and metadata addresses are refused.
2. yt-dlp reads the video's length, then downloads only its audio (mono, small) into a temporary directory.
3. Gemini (paid tier only, ADR-0005) writes a timestamped transcript. The container returns it with the model's token usage; the Worker records the cost.
4. The directory is removed in `finally`: on success, on failure and on timeout. Nothing is kept.

The handler is `createFetcher` in `@spark/deep-fetch/fetcher` (tested with fake tools); `src/tools.ts` is the real yt-dlp, ffmpeg and Gemini; `src/main.ts` is the Node server.

```sh
FETCHER_TOKEN=local pnpm --filter @spark/fetcher start   # needs yt-dlp and ffmpeg on the PATH
docker build -f apps/fetcher/Dockerfile .                # from the repository root
```

The token must be 32 or more characters (the container refuses to start otherwise), is compared in constant time and is never logged. yt-dlp is pinned in the Dockerfile and verified against its release's `SHA2-256SUMS`. Deploying is `.github/workflows/deploy-fetcher.yml`, which runs as its own least-privilege service account and skips until the secrets in `docs/deploy.md` exist. Not built here: keyframes for Visual vectors and a headless browser (see the Deep fetch PR).
