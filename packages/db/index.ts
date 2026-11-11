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
  type ExportedMemory,
  type FileCheck,
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
export {
  accountJobs,
  DELETION_GRACE_MINUTES,
  EXPORT_COOLDOWN_MINUTES,
  EXPORT_TTL_HOURS,
  exportKey,
  openAccount,
  type Account,
  type AccountJobs,
  type ExportRequest,
  type LibraryExport,
  type SessionInfo,
} from "./lib/account";
export {
  ANONYMISED_USER,
  deletionRequested as isDeletionRequested,
  endSessionIfDeleting,
} from "./lib/owner";
export { indexingStore, type IndexingStore } from "./lib/indexing";
export * as schema from "./lib/schema";
