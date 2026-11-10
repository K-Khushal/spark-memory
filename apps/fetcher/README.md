# apps/fetcher

The Deep fetch container (ADR-0010): runs on Google Cloud Run's free tier with yt-dlp, ffmpeg and a headless browser. It downloads media temporarily, returns transcripts and keyframes for Indexing, and deletes the media when the job ends. It never logs into platforms.

Built in the Deep fetch ticket.
