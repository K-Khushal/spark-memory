# Jev (TypeSafe) assigns Categories and judges Direct matches

Categorisation is a separate call to Jev, not part of the extraction call. Jev reads text and images, takes the user's own Category list per request (up to 255 options) and returns calibrated probabilities. That gives us several Categories per Memory, user-created Categories and cheap re-categorisation of a whole Library ($0.042 per 1M input tokens, output free, no training on user data) without prompt-engineering an LLM. The same model answers "is this Memory what the user described?" for the top search results, which decides the Direct match / Related match split.

## Consequences

- If Jev is unavailable, Categories fall back to comparing the Memory's embedding against Category name embeddings, and Direct matches fall back to score thresholds tuned on the search test set.
- Jev's latency isn't published. It sits on the search hot path only if the search test set shows it is fast enough.
