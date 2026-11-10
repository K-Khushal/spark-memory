# No end-to-end encryption; a per-Memory AI opt-out instead

Spark indexes Memories on the server (AI descriptions, OCR, embeddings), and that is impossible if only the user's devices can decrypt their content. So Memories are encrypted at rest by our providers (Cloudflare, Neon) but readable by Spark's servers and, during Indexing, by our AI providers. We say this plainly at sign-up and on the privacy page. For sensitive saves (bank statements, IDs) the user can switch on **AI opt-out** for a Memory: it never reaches an AI provider and is findable only by its own text, title and Capture note.

## Considered Options

- **End-to-end encryption with on-device indexing:** strongest privacy, but no visual search on the web, much weaker models, and indexing that differs per device. That breaks the core promise.
