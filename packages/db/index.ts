// Public entry point of @spark/db. Keep it small; put implementation in lib/.
export {
  checkDatabase,
  databaseFailure,
  type DatabaseFailure,
  type DatabaseHealth,
} from "./lib/health";
export { openDatabase, type Database } from "./lib/client";
export {
  openLibrary,
  sweepAbandonedUploads,
  UPLOAD_WINDOW_HOURS,
  type CaptureResult,
  type EditResult,
  type FileCheck,
  type FileUpload,
  type ImageCaptureResult,
  type MemoryFileInfo,
  type MemoryImage,
  type Library,
  type MatchedBy,
  type MatchedPart,
  type Memory,
  type Page,
  type SearchOptions,
  type SearchResult,
  type VectorProbe,
} from "./lib/library";
export {
  indexingStore,
  type Embedding,
  type IndexingStore,
} from "./lib/indexing";
export * as schema from "./lib/schema";
