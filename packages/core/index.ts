// Public entry point of @spark/core: the glossary's vocabulary as types.
export {
  MEMORY_KINDS,
  PRESERVATIONS,
  INDEX_STATES,
  MemoryKind,
  Preservation,
  IndexState,
  TextCapture,
  MemoryEdit,
  MemoryEditRequest,
  AiOptOut,
  AccountDeletion,
  confirmsDeletion,
  IMAGE_TYPES,
  ImageType,
  THUMBNAIL_TYPES,
  THUMBNAIL_MAX_BYTES,
  ImageCapture,
  PDF_TYPE,
  PAGE_IMAGE,
  PdfCapture,
  indexedPages,
  isPartlyIndexed,
} from "./lib/memory";
export {
  FREE_ALLOWANCE,
  isFileWithinAllowance,
  PLANS,
  DEFAULT_PLAN,
  type Plan,
} from "./lib/allowance";
export {
  INDEXING,
  EMBEDDING,
  embeddingSpace,
  INDEX_FAILURES,
  INDEXING_OUTPUT_JSON_SCHEMA,
  IndexingOutput,
  PDF_SCAN_OUTPUT_JSON_SCHEMA,
  PdfScanOutput,
  Palette,
  type IndexFailure,
  type ProviderName,
} from "./lib/indexing";
export {
  ROLES,
  adminEmails,
  isAdmin,
  isVerifiedAdmin,
  rolesFor,
  type Role,
} from "./lib/role";
export {
  DAILY_BUDGET_KEY,
  DAILY_BUDGET_MAX_MICROS,
  budgetPaused,
  effectiveDailyBudgetMicros,
  parseDailyBudgetMicros,
} from "./lib/budget";
export {
  PRODUCT_EVENTS,
  allowOutgoingProductEvent,
  productAnalyticsEnabled,
  productPayload,
  publicAnalytics,
  sendProductEvent,
  type ProductEvent,
  type ProductPayload,
} from "./lib/product-events";
export {
  keptPage,
  LINK_MAX_CHARS,
  LinkCapture,
  MIN_PRESERVED_CHARS,
  PageExtract,
  SCREENSHOT_MAX_BYTES,
  type LinkMetadata,
  linkFromPaste,
  normaliseUrl,
  isYouTubeVideo,
  sourceHost,
} from "./lib/link";

export {
  youtubeId,
  isVideoUrl,
  videoTimestamp,
  formatTimestamp,
  type VideoMetadata,
  type TranscriptSegment,
} from "./lib/link";

export {
  budgetWindow,
  DEEP_FETCH,
  engineFor,
  isThin,
  retryDelaySeconds,
  type DeepFetchEngine,
  type DeepFetchFailure,
  type DeepFetchState,
  type DeepFetchView,
} from "./lib/deep-fetch";
