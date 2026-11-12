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
  SWEEP_BUDGET_MS,
  UPLOAD_URL_MINUTES,
  UPLOAD_WINDOW_HOURS,
  type CaptureResult,
  type EditResult,
  type ExportedMemory,
  type FileCheck,
  type FileUpload,
  type ImageCaptureResult,
  type PageImage,
  type PdfCaptureResult,
  type LinkCaptureResult,
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
  lockOwner,
} from "./lib/owner";
export {
  indexingStore,
  type Claim,
  type Embedding,
  type IndexingStore,
  type IndexMessageTarget,
} from "./lib/indexing";
export {
  deepFetchStore,
  type DeepFetched,
  type DeepFetchClaim,
  type DeepFetchStore,
  type DeepFetchTarget,
} from "./lib/deep-fetch";
export {
  ADMIN_USERS_LIMIT,
  openAdmin,
  readDailyBudgetMicros,
  type Admin,
  type BudgetState,
  type DailySpend,
  type UserUsage,
} from "./lib/admin";
export * as schema from "./lib/schema";
