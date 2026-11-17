import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A Drizzle database over a small pool. On Workers, open one per request with
 * `env.HYPERDRIVE.connectionString` (Hyperdrive owns the real pool) and
 * `close()` it once the response is sent.
 */
export function openDatabase(connectionString: string): {
  db: Database;
  close: () => Promise<void>;
} {
  const pool = new Pool({ connectionString, max: 5 });
  // An idle client the server drops (restart, failover) must not crash the
  // Worker; the next query reconnects.
  pool.on("error", (error: Error & { code?: string }) =>
    console.error("db: idle client error", error.code ?? error.message)
  );
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}
