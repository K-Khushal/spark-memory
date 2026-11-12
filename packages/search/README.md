# Search

`createSearch` provides instant and full search and More Like This. `understandQuery`
is the pure structure parser: kind, Source, calendar range (chrono-node, client IANA
timezone), and colour. Ambiguous standalone colour and singular kind words stay
content. Calendar ranges use inclusive start and exclusive end, including DST.
The remainder is searched by meaning; colour words stay as query context and in
keyword search so a named colour in content remains findable. Invalid client timezones fall back to UTC.

Filters apply before each SQL search leg and its limit. Palette RGB proximity adds
at most 0.002 to RRF score; it cannot overwhelm the keyword/vector fusion. Colour
chips require proximity >= 0.65; prose uses proximity as a soft signal. Palettes
already come from image Capture, without an AI call. Empty-query browsing bypasses
providers and is paginated (40 results, maximum 100 per page). Category filters can
join the typed filter object when #24 provides Categories. Why-chips use actual SQL
match provenance; timestamped Passages can supply a timestamp without fabricated data.

## Search data

Only committed searches and result clicks are stored, never typing. Every row is
owner-scoped. Recent searches deduplicate to 20; events retain at most 1,000 rows per
owner. Both expire after 30 days (hidden at read/export immediately, physically
removed by the hourly account sweep). Account deletion cascades both tables. Library
exports include `searches.json`, with recent searches and the retained query/click,
1-based position and reformulation events. Deleting recent searches removes those
recents; metric events expire independently. No query text is sent to analytics,
Sentry or application console logs.
