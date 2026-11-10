import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Bindings } from "../src/env";

// Integration test: needs Postgres + pgvector (`docker compose up -d db` locally,
// a service container in CI). DATABASE_URL comes from the root .env or CI.
const databaseUrl = process.env.DATABASE_URL;
const unreachableUrl = "postgres://spark:spark@127.0.0.1:1/spark";

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

function getHealth(connectionString: string) {
  const env = { HYPERDRIVE: { connectionString } } as Bindings;
  return worker.fetch(new Request("http://spark.test/api/health"), env, ctx);
}

describe.skipIf(!databaseUrl)("GET /api/health", () => {
  it("reports the database is reachable", async () => {
    const res = await getHealth(databaseUrl!);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "spark", db: "ok" });
  });

  it("reports 503 when the database is unreachable", async () => {
    const res = await getHealth(unreachableUrl);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      service: "spark",
      db: "unreachable",
    });
  });

  it("logs only a failure category, never the host or port", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await getHealth(unreachableUrl);
      const logged = log.mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("refused");
      expect(logged).not.toContain("127.0.0.1");
      expect(logged).not.toMatch(/:\d+/);
    } finally {
      log.mockRestore();
    }
  });
});
