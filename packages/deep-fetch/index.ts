// Public entry point of @spark/deep-fetch: Deep fetch (ADR-0010) behind one
// call, with two swappable engines, and the job that runs it. The
// container's handler is in ./fetcher.
export {
  createDeepFetch,
  fakeEngine,
  type DeepFetch,
  type DeepFetchRequest,
  type Engine,
  type EngineResult,
  type EngineUsage,
  type Fetched,
} from "./lib/engine";
export { cloudflareBrowser } from "./lib/cloudflare";
export { cloudRunFetcher } from "./lib/cloud-run";
export {
  createDeepFetchWorker,
  type Claim,
  type DeepFetchAi,
  type DeepFetchJobStore,
  type DeepFetchOutcome,
  type DeepFetchWorker,
  type Reindex,
} from "./lib/worker";
