import { Client } from "pg";

export type DatabaseHealth = { ok: true } | { ok: false; error: string };

/**
 * Opens one connection and runs a trivial query. Never throws: an unreachable
 * database is a result, not an exception. On Workers, pass
 * `env.HYPERDRIVE.connectionString`; Hyperdrive owns the pool, so a client per
 * call is the documented pattern.
 */
export async function checkDatabase(
  connectionString: string,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {}
): Promise<DatabaseHealth> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });
  try {
    await client.connect();
    // now() is STABLE, so Hyperdrive never answers this from its query cache.
    await client.query("select now()");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => {});
  }
}
