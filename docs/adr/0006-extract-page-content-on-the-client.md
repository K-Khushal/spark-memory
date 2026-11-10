# Page content is extracted on the client at Capture time

The browser extension (and later the mobile share extensions) extracts readable text, metadata and a screenshot of the visible area from the page the user is looking at, and uploads them with the Capture. This is the only reliable way past Instagram, X and TikTok login walls, and it keeps HTML parsing out of the Worker's 10 ms CPU budget. Server-side fetching (Open Graph tags, oEmbed, Jina Reader) is only a fallback for URLs pasted into the dashboard.
