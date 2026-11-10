import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { checkDatabase } from "../index";

// Integration test: needs Postgres + pgvector with migrations applied
// (`pnpm --filter @spark/db db:migrate`). DATABASE_URL comes from the root .env or CI.
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("checkDatabase", () => {
  it("is ok when Postgres answers", async () => {
    expect(await checkDatabase(databaseUrl!)).toEqual({ ok: true });
  });

  it("is not ok, without throwing, when Postgres is unreachable", async () => {
    const result = await checkDatabase(
      "postgres://spark:spark@127.0.0.1:1/spark"
    );
    expect(result).toEqual({ ok: false, reason: "refused" });
  });
});

describe.skipIf(!databaseUrl)("first migration", () => {
  it("enables pgvector and pg_trgm", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ extname: string }>(
        "select extname from pg_extension where extname in ('vector', 'pg_trgm') order by extname"
      );
      expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "vector"]);
    } finally {
      await client.end();
    }
  });
});
