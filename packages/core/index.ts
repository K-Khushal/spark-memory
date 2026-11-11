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
