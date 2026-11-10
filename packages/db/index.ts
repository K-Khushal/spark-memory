// Public entry point of @spark/db. Keep it small; put implementation in lib/.
export {
  checkDatabase,
  type DatabaseFailure,
  type DatabaseHealth,
} from "./lib/health";
