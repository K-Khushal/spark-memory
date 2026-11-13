# @spark/search

Hybrid search for one person's Library (ADR-0004, PLAN.md §6): instant, full and More Like This, with the query understood first.

Entry point: `index.ts` (`createSearch`, `understandQuery`, `forgetQueryVectors`). Implementation in `lib/`, tests in `tests/`.

## Understanding the query

`understandQuery(text, { now, timezone })` is pure. It reads kind ("pdfs", "screenshots"), Source ("from instagram", "from nytimes.com"), when it was saved ("last month", "since March", "from June 1 to June 30", with chrono-node for the written dates) and colour ("orange"). What is left is searched by meaning. The vocabulary (colours, Source names, kinds, chip shapes) lives in `@spark/core` so chips, server and parser agree.

A word is a filter only where it reads like one:

- Written dates need "from", "since", "after" or "before" ("passport appointment on 3 May" is about a date inside a Memory); relative ones ("yesterday", "last week", "past 7 days") stand alone.
- "links" and "notes" lead a search or sit beside a date or Source ("links about sourdough", "notes from May"), but "meeting notes" is content. Singular kind words need a date or Source beside them ("pdf from last month", not "pdf rendering").
- Colour names inside a phrase ("red hat", "black friday") are content.
- A word with a dot is a Source only when its ending is a real one (`bbc.co.uk`, not `next.js` or `config.yaml`); a Source name that is also a word ("medium") counts only after "from" or "via" ("steak on medium heat" is about steak).
- A lone ambiguous word ("orange", "notes") stays content.

Colour stays in the words: Memories say "purple flowers", "red hair", and dropping the word lost three searches in the test set. It also becomes a **preference** (`prefer`): a palette near it ranks higher. It becomes a requirement only when nothing else is left to search by ("orange pdfs from last month"), or when it comes from a colour chip.

Calendar ranges are the person's own days (client IANA timezone, falling back to UTC), start included, end excluded, using the offset in force on each boundary across daylight saving.

## Filters, chips, ranking

`createSearch().search(query, mode, { timezone, chips, page })` merges what the words said with the chips, which win where they disagree, and passes the Library its own words: `kinds`, and `filters` (`hosts`, `after`, `before`, `colour`, `prefer`). Over HTTP it is `POST /api/search` with `{ q, mode, timezone, chips, page }` in the JSON body: a typed query or a chosen filter never goes in a URL, because URLs reach request logs.

In the database (`search_memories`, migration 0022) every filter is a plain expression on `memory` that each leg applies itself (`in_scope`), before its limit, so no leg's limit can cut a filtered Memory off, and a search with no filter costs what it did before. Colour compares an image's stored palette (worked out in the browser at Capture, no AI cost) to the colour with a perceptual RGB distance; within 0.14 of black-to-white counts as near. A palette near a preferred colour adds at most 0.003 to the fused score, a few places among close matches, never enough to lift a weak match over a strong one.

With no words, filters browse, with no provider call. Each result says why (`part.kind = "filter"`): the palette colour found, the host, the day saved or the kind.

Pages are 40. The answer's `next` says where the following page begins and the client hands it back as `page`. Browsing newest first (no words, no colour) uses `c:<id of the last Memory>`, read off `memory_user_captured_idx`, so a deep page costs what the first does; anything ranked by a score (words, colour) uses `o:<how many came before>`, and a ranked search holds at most a few hundred results anyway.

## Direct and Related Matches

Every result carries `match: "direct" | "related"` (ADR-0008, PLAN.md §6.4); the list stays in rank order and a client shows Direct first (the web wall, ⌘K and the MCP server read the same shape). Only the first `JUDGING.window` (20) results of a search with words can be Direct; later ones and later pages are Related. A browse (no words) has no judging: a filter's results are all Direct.

One interface, `MatchJudge` (`lib/judge.ts`), two implementations:

- **`thresholdJudge`** decides from what the legs said (`thresholdMatch` in `@spark/core`, pure). Direct when a filter found it; its words did and it scores at least `keywordMinRelative` of the best; a vector came within `directDistance`; or it is the best result, two legs found it and the runner-up scores at most `leadRunnerUp` of it. It always runs first, so there is a verdict for every result. The numbers are tuned on the search test set (`pnpm --filter @spark/evals eval:tune`, evals/README.md).
- **`jevMatchJudge`** asks Jev Noul "is saved item _n_ what the person described?" for the Memories it may read, in one request with one Noul question per Memory (`JUDGING.jevThreshold` of 0.5). Memories with AI opt-out and Samples are never sent: `Library.judgingTexts` leaves them out, and a Memory without text is not judged and keeps its threshold verdict. It checks the daily budget first and records an `ai_call` (an estimate when the call fails or is cut off, because it may still have been billed).

Jev is off unless `JEV_API_KEY` and `JEV_ENABLED=true` are set (docs/research/jev.md). When on, it runs only in full mode, only with time left (`JUDGING.fullBudgetMs` less `reserveMs` less what has run, and at least `jevMinMs`), with a deadline of at most `jevTimeoutMs`, aborted when it passes. A slow, failing or invalid Jev answer changes nothing: the thresholds' verdicts stand, so full mode's p95 stays inside its 600 ms by construction. `evals --latency` shows how often Jev is dropped under assumed delays.

## Search data

Only committed searches and clicks on their results are stored, never typing. Every row belongs to one person.

| Data                              | Kept                                                                                 | Removed                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Recent searches (`recent_search`) | 20 per person, one per distinct query, 30 days                                       | One or all by the person; at 30 days (hidden at once, deleted by the hourly sweep); with the account |
| Search events (`search_event`)    | Query, clicked Memory, its place (1 to 100), reformulation; latest 1,000 and 30 days | At 30 days; with the account; the Memory link goes when the Memory does                              |

Both are in the Library export as `searches.json` (what is still retained). Deleting a recent search does not delete the events behind it: they are the product's own measure and expire on their own. No query text goes to Sentry (events carry no URL query), analytics or the console.
