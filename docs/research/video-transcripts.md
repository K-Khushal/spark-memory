# Public video transcripts (#19)

Checked 12 November 2026. No server-side platform login, uploaded cookies,
residential proxy, PoToken bypass, or private API is used (ADR-0010).

- [YouTube captions.download](https://developers.google.com/youtube/v3/docs/captions/download)
  requires authorization and permission to download the caption track. It is
  not an anonymous transcript endpoint for arbitrary public videos.
- [Gemini video input](https://aistudio.google.com/docs/video-understanding)
  accepts public YouTube URLs and supports timestamp questions. This is a model
  interpretation of video, not a guarantee of a complete verbatim transcript.
- [Gemini pricing](https://aistudio.google.com/docs/pricing) distinguishes paid
  input/output billing and data treatment from the free tier. Spark retains its
  configured Flash-Lite model/prices and explicit paid-tier gate (ADR-0005).
  This change sends only gathered text/metadata through that existing adapter;
  it adds no video-token costs. No paid key was used during verification.

## Implementation decision

Read caption tracks only when a public YouTube watch page exposes them in
`ytInitialPlayerResponse`. The signed track URL must be HTTPS on
`www.youtube.com/api/timedtext`, and is fetched as JSON3 through the existing
public-fetch timeout, DNS, redirect and per-hop permission guard. This is a
best-effort public-page format, not a supported YouTube API contract. Cloud
IPs, consent pages and missing captions commonly make it unavailable. Never
work around those refusals. The 256 KB HTML cap may miss a player response
late in a large page; that also becomes metadata fallback.

A known positive duration no greater than the configured 60-minute allowance
is required before fetching captions. Unknown duration, over-allowance,
invalid/oversized/truncated captions and failures keep metadata only. Vimeo
URLs become video Memories with metadata fallback; arbitrary media download
and keyframes belong to the two-engine Deep fetch work in #21.

Third-party video always stays Reference Only, even with a stored transcript.
Passages use transcript text and carry seconds. Keyword matches also identify
the matching segment. No generated transcript or fabricated timestamp is kept.
Gemini can describe only the supplied metadata/transcript, and only through
the existing paid-tier gate. Without that provider, the Memory remains
Searchable by its own text and metadata. This deliberately follows the cook
brief's fallback over the issue's original direct-Gemini-transcription wording.
