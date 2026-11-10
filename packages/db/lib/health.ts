import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

/** Why the check failed. A fixed category: driver messages carry host and port. */
export type DatabaseFailure = "timeout" | "refused" | "auth" | "unknown";

export type DatabaseHealth =
  { ok: true } | { ok: false; reason: DatabaseFailure };

/**
 * The failure category of a database error (or of its `cause`, as Drizzle
 * wraps driver errors). Safe to log, unlike the error: its message can carry
 * query parameters, host and port.
 */
export function databaseFailure(error: unknown): DatabaseFailure {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const own = classify(error);
  return own === "unknown" && cause ? databaseFailure(cause) : own;
}

function classify(error: unknown): DatabaseFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (code === "28P01" || code === "28000") return "auth";
  if (code === "ECONNREFUSED" || /refused/i.test(message)) return "refused";
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(message)) {
    return "timeout";
  }
  return "unknown";
}

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
    await drizzle(client).execute(sql`select now()`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: databaseFailure(error) };
  } finally {
    await client.end().catch(() => {});
  }
}
