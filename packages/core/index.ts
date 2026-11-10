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
} from "./lib/memory";
export {
  FREE_ALLOWANCE,
  isFileWithinAllowance,
  PLANS,
  DEFAULT_PLAN,
  type Plan,
} from "./lib/allowance";
