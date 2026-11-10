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
  type CaptureResult,
  type EditResult,
  type Library,
  type MatchedBy,
  type Memory,
  type Page,
  type SearchResult,
} from "./lib/library";
export * as schema from "./lib/schema";
