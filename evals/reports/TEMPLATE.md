# Search test set report: <date>

Run by: <who>. Commit: <sha>. Sample Library: <n> Memories. Searches: <n> (30 tricky, <n> owner).
Providers: Gemini Flash-Lite (extraction), Gemini Embedding 2, paid tier. Fake-mode baseline for reference: top-1 <x>/<n>, top-5 <x>/<n>.

## Spark vs Supermemory (ADR-0009)

Output of `compare:supermemory`. Supermemory plan and credits used: <plan, credits>.

| Search kind   | Spark top-1 | Spark top-5 | Supermemory top-1 | Supermemory top-5 |
| ------------- | ----------- | ----------- | ----------------- | ----------------- |
| colour        |             |             |                   |                   |
| text in image |             |             |                   |                   |
| typo          |             |             |                   |                   |
| Hinglish      |             |             |                   |                   |
| date          |             |             |                   |                   |
| looks like    |             |             |                   |                   |
| passage       |             |             |                   |                   |
| **All**       |             |             |                   |                   |

Reading: <where each wins, and whether Supermemory beats Spark enough to reopen ADR-0009>.

## Vector size

Output of `experiments dimensions --yes`.

| dimensions | top-1 | top-5 | AI cost |
| ---------- | ----- | ----- | ------- |
|            |       |       |         |

Storage per Memory at each size: <halfvec bytes x vectors per Memory>. Decision: <size and why>.

## Passage length

Output of `experiments passages --yes`.

| passages | top-1 | top-5 | AI cost |
| -------- | ----- | ----- | ------- |
|          |       |       |         |

Decision: <characters and why; `EMBEDDING.passageChars`>.

## Reranker

Output of `experiments rerank --yes`, plus full-mode p95 latency with each (the budget is 600 ms).

| rerank | top-1 | top-5 | AI cost |
| ------ | ----- | ----- | ------- |
|        |       |       |         |

Decision: <reranker or none, and why>.

## Per-search results

<Paste the `eval:real` per-search list. Note every search that failed and what it says about Indexing or search.>

## Follow-ups

- <issues to open>
