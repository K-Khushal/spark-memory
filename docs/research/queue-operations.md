# Queue operations and Category refreshes

Checked 14 November 2026. [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) includes 10,000 operations per day on Workers Free, shared across queues. A normal small message uses three operations: write, read, delete/acknowledgement. Batching reduces Worker subrequests, **not** per-message operations. Retries add reads; dead-letter delivery adds operations too.

The hourly sweep therefore has two separate paths:

| Work | Maximum per invocation/hour | Queue messages | Base queue operations |
| --- | ---: | ---: | ---: |
| Category-only refresh | 500 Memories | 0 | 0 |
| Actual re-embedding | 100 Memories | 100 | about 300 |

At the real-embed cap, 24 × 100 × 3 = 7,200 base operations/day. That leaves about 2,800 operations (roughly 933 ordinary messages) for fresh Indexing, stalled Indexing, Deep fetch, imports and retries. This is headroom, not a guarantee that unlimited other traffic fits. The daily AI-dollar budget is independent; a zero-dollar classification must not spend queue operations.

Category refreshes run directly in Postgres, in batches of 100, with a 500-Memory cap and a two-second wall-time budget. Each statement has a bounded timeout. A nonblocking per-owner Categories advisory lock comes before any Memory write; a busy owner is skipped. Revision, run, generation, current vectors, AI opt-out, Locked categories and the owner's current Category list are checked at the write. Vector comparisons and ranking stay in Postgres to keep the cron's Worker CPU use small.

Ordinary Indexing persists Category prototype vectors by embedding space and categoriser version, so changed prototype sentences cannot reuse stale vectors. Built-in prototypes are shared public sentences; custom prototypes are scoped to their owner and cascade away on account deletion. Creating or renaming a Category prepares missing prototypes under the existing AI budget and records the cost, without queuing any Memory refreshes. The cron uses only these stored prototypes and current Overview vectors. If a required prototype is missing, it leaves the Memory pending until normal Indexing or Category preparation supplies it; the cron never calls an AI provider to warm a cold cache or guesses Other.

The fallback keeps `CATEGORISING.embeddingThreshold`, the three-Category limit, and built-in/creation-order tie breaking. Category-only work continues when the AI-dollar budget is spent. Real embed messages retain the existing daily-budget and revision fences.
