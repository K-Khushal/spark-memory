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
  IMAGE_TYPES,
  ImageType,
  THUMBNAIL_TYPES,
  THUMBNAIL_MAX_BYTES,
  ImageCapture,
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
  INDEX_FAILURES,
  INDEXING_OUTPUT_JSON_SCHEMA,
  IndexingOutput,
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
