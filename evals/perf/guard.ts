/** An explicit throwaway database is the only write target this benchmark accepts. */
export const PERF_CONTAINER_COMMAND =
  "docker run -d --name spark-perf -e POSTGRES_USER=spark -e POSTGRES_PASSWORD=spark -e POSTGRES_DB=perf_spark -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data:rw,size=1536m pgvector/pgvector:pg17 -c max_wal_size=128MB -c min_wal_size=32MB -c checkpoint_timeout=60s";
const refusal = () =>
  new Error(
    `Set an explicit PERF_DATABASE_URL to a localhost database named perf_* on a non-5432 port, distinct from .env DATABASE_URL. Create it with:\n${PERF_CONTAINER_COMMAND}\nFind its port with: docker port spark-perf 5432\nThen set PERF_DATABASE_URL=postgres://spark:spark@localhost:<port>/perf_spark`
  );
function database(url: string) {
  const parsed = new URL(url);
  return {
    parsed,
    name: decodeURIComponent(parsed.pathname.slice(1)),
    port: parsed.port || "5432",
  };
}
export function perfDatabaseUrl(
  explicit: string | undefined,
  devUrl?: string
): string {
  if (!explicit) throw refusal();
  try {
    const { parsed, name, port } = database(explicit);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      port === "5432" ||
      !/^perf_[a-zA-Z0-9_]+$/.test(name) ||
      parsed.search ||
      parsed.hash
    )
      throw refusal();
    if (devUrl) {
      const dev = database(devUrl);
      const devLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
        dev.parsed.hostname
      );
      if (
        explicit === devUrl ||
        (devLocal && dev.port === port && dev.name === name)
      )
        throw refusal();
    }
    return explicit;
  } catch {
    throw refusal();
  }
}
export function requireFakeIndexing(provider: unknown, jevEnabled: unknown) {
  if (provider !== "fake" || jevEnabled !== false)
    throw new Error(
      "perf requires the local Worker's INDEXING_PROVIDER=fake and disabled Jev; refusing Capture"
    );
}
