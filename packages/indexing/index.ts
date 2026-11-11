// Public entry point of @spark/indexing: one call, index(job), with the
// provider chain behind a seam (ADR-0005). Adapters are exported for wiring
// and tests; everything else stays in lib/.
export {
  backoffSeconds,
  createIndexer,
  type AiCall,
  type EmbedMemory,
  type Extraction,
  type IndexJob,
  type IndexOutcome,
  type IndexStore,
  type Indexer,
  type PendingMemory,
  type Priority,
} from "./lib/indexer";
export {
  ProviderError,
  type ExtractRequest,
  type Provider,
  type ProviderReply,
  type Usage,
} from "./lib/provider";
export { embedderFor, providerChain, type ChainOptions } from "./lib/chain";
export {
  embedCostMicros,
  embeddingInputs,
  passages,
  queryText,
  type EmbedInput,
  type Embedder,
  type Embedding,
  type EmbedUsage,
} from "./lib/embedder";
export { geminiEmbedding } from "./lib/gemini-embedding";
export { workersAi, type AiBinding } from "./lib/workers-ai";
export { gemini, type GeminiOptions } from "./lib/gemini";
export { fakeEmbedder, fakeProvider, FAKE_WORD } from "./lib/fake";
export { SYSTEM } from "./lib/prompt";
