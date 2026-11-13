// The container's side of Deep fetch (apps/fetcher wires it to Node, yt-dlp,
// ffmpeg and Gemini). Separate from index.ts so the Worker never bundles it.
export { createFetcher, ToolError, type MediaTools } from "./lib/service";
export { MIN_TOKEN_CHARS } from "./lib/engine";
