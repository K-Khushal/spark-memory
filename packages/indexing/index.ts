// Public entry point of @spark/indexing: one call, index(job), with the
// provider chain behind a seam (ADR-0005). Adapters are exported for wiring
// and tests; everything else stays in lib/.
export {
  backoffSeconds,
  createIndexer,
  type AiCall,
  type Claim,
  type EmbedMemory,
  type Extraction,
  type IndexJob,
  type IndexOutcome,
  type IndexStore,
  type Indexer,
  type PendingMemory,
  type Priority,
  HELD_CATEGORY_MICROS,
} from "./lib/indexer";
export {
  ProviderError,
  type ExtractRequest,
  type MarkdownBinding,
  type Provider,
  type ProviderReply,
  type Usage,
} from "./lib/provider";
export {
  embedderFor,
  pdfReaderFor,
  providerChain,
  transcriberFor,
  type ChainOptions,
} from "./lib/chain";
export {
  embedCostMicros,
  embeddingInputs,
  pagePassages,
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
export { geminiTranscriber, type Transcriber } from "./lib/gemini-transcribe";
export { fakeEmbedder, fakeProvider, FAKE_WORD } from "./lib/fake";
export { SCAN_SYSTEM, SYSTEM } from "./lib/prompt";
export {
  fakePdfReader,
  isScan,
  markdownPages,
  pdfBody,
  workersAiPdf,
  type PdfReader,
} from "./lib/pdf";
export {
  createGatherer,
  readPage,
  type Gathered,
  type Gatherer,
} from "./lib/link/gather";
export {
  dohResolver,
  GATHER,
  isPrivateAddress,
  isTransient,
  publicFetch,
  type PublicResponse,
  type Resolve,
} from "./lib/link/public-fetch";
export {
  categorise,
  prepareCategoryPrototypes,
  jevCostMicros,
  jevTokenEstimate,
  type CategoryClient,
} from "./lib/categories";
export { jevCategories, jevJudge, type JudgeClient } from "./lib/jev";
