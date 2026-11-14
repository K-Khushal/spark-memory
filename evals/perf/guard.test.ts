import { describe, expect, it } from "vitest";
import {
  perfDatabaseUrl,
  requireFakeIndexing,
  requireWorkerDatabase,
} from "./guard";

const safe = "postgres://spark:spark@localhost:32828/perf_spark";
describe("performance database guard", () => {
  it("accepts an explicit isolated performance database", () => {
    expect(
      perfDatabaseUrl(safe, "postgres://spark:spark@localhost:5432/spark")
    ).toBe(safe);
  });
  it.each([
    undefined,
    "not a url",
    "postgres://spark:spark@example.com:32828/perf_spark",
    "postgres://spark:spark@localhost:5432/perf_spark",
    "postgres://spark:spark@localhost/perf_spark",
    "postgres://spark:spark@localhost:32828/spark",
    "postgres://spark:spark@localhost:32828/perf_spark?host=example.com",
  ])(
    "refuses unsafe input with an exact throwaway container command: %s",
    (url) => {
      expect(() => perfDatabaseUrl(url)).toThrow(
        "docker run -d --name spark-perf"
      );
    }
  );
  it("refuses the .env database even through a loopback alias or different credentials", () => {
    expect(() =>
      perfDatabaseUrl(
        safe,
        "postgres://other:password@127.0.0.1:32828/perf_spark"
      )
    ).toThrow("PERF_DATABASE_URL");
  });
});
it.each([undefined, "gemini", "real", "FAKE"])(
  "refuses provider %s",
  (provider) => {
    expect(() => requireFakeIndexing(provider, false)).toThrow(
      "INDEXING_PROVIDER=fake"
    );
  }
);
it("accepts only fake Indexing", () => {
  expect(() => requireFakeIndexing("fake", false)).not.toThrow();
});

it("refuses paid Jev judging even with fake extraction and embedding", () => {
  expect(() => requireFakeIndexing("fake", true)).toThrow(
    "INDEXING_PROVIDER=fake"
  );
});

it("refuses a preflight that omits the Jev setting", () => {
  expect(() => requireFakeIndexing("fake", undefined)).toThrow(
    "INDEXING_PROVIDER=fake"
  );
});

it("never falls back to the .env database when the explicit opt-in is missing", () => {
  expect(() => perfDatabaseUrl(undefined, safe)).toThrow("PERF_DATABASE_URL");
});

it("refuses missing or mismatched Worker databases before sign-in", () => {
  for (const name of [undefined, "spark", "perf_other"])
    expect(() => requireWorkerDatabase(safe, name)).toThrow("database");
  expect(() => requireWorkerDatabase(safe, "perf_spark")).not.toThrow();
});
