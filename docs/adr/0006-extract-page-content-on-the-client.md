# Page content is extracted on the client at Capture time

The browser extension (and later the mobile share extensions) extracts readable text, metadata and a screenshot of the visible area from the page the user is looking at, and uploads them with the Capture. This is the only reliable way past Instagram, X and TikTok login walls, and it keeps HTML parsing out of the Worker's 10 ms CPU budget. Server-side fetching (Open Graph tags, oEmbed, Jina Reader) is only a fallback for URLs pasted into the dashboard.

## Amendment, 12 November 2026 (proposed, owner to confirm)

Links pasted into the dashboard are parsed in the Worker (#16): one linear pass over at most 256 KB of the page's HTML for its metadata and readable text (`packages/indexing/lib/link/`). The scan measured about 24 ms of CPU per MB, so the cap keeps the worst page near 6 ms, inside the 10 ms budget. The extension and the mobile share extensions still extract on the client, which stays the only way past login walls. oEmbed (a fixed list of providers) and Jina Reader (off unless `LINK_READER` is set) are called only for a Source confirmed to be on the public web, and never for AI opt-out.
