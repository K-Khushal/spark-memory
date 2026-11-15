import { indexingStore, type Database } from "../index";

/**
 * Category fixtures use fake AI, but real reservations. Parallel spend tests
 * deliberately fill the shared daily budget and holds; they must not stop
 * these fixtures from becoming Searchable or finishing a Category backfill.
 */
export const categoryStore = (db: Database) =>
  indexingStore(db, { budget: async () => Number.MAX_SAFE_INTEGER });
