# Search test set

A fixed sample Library (~150 freely licensed Memories) and 50 vague searches with expected answers: 30 tricky ones written by agents, 20 real ones written by the product owner. It reports how often the right Memory comes first and how often it is in the top 5. It compares Spark with a Supermemory baseline (ADR-0009) and decides vector size, passage length and reranker (ADR-0004). CI fails on regression.

Built in the search test set ticket. **No search change merges without running it.**
