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
  type FileUpload,
  type ImageCaptureResult,
  type MemoryFileInfo,
  type MemoryImage,
  type Library,
  type MatchedBy,
  type Memory,
  type Page,
  type SearchResult,
} from "./lib/library";
export * as schema from "./lib/schema";
