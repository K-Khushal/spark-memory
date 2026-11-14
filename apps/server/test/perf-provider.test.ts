import { expect, it } from "vitest";
import { routes } from "../src/routes";
import type { Bindings } from "../src/env";

it("reports the actual local provider, including a non-fake configuration", async () => {
  for (const provider of ["fake", "gemini"]) {
    const res = await routes.request(
      "http://localhost/dev/indexing-provider",
      {},
      {
        SPARK_ENV: "local",
        HYPERDRIVE: {
          connectionString: "postgres://user:secret@localhost:32828/perf_spark",
        },
        INDEXING_PROVIDER: provider,
      } as Bindings
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider,
      jevEnabled: false,
      database: "perf_spark",
    });
  }
});
it("does not expose the dev provider endpoint outside local development", async () => {
  const res = await routes.request(
    "http://localhost/dev/indexing-provider",
    {},
    {
      SPARK_ENV: "production",
      INDEXING_PROVIDER: "fake",
    } as Bindings
  );
  expect(res.status).toBe(404);
});

it("reports enabled paid Jev rather than treating fake extraction as a safe stack", async () => {
  const res = await routes.request(
    "http://localhost/dev/indexing-provider",
    {},
    {
      SPARK_ENV: "local",
      HYPERDRIVE: {
        connectionString: "postgres://user:secret@localhost:32828/perf_spark",
      },
      INDEXING_PROVIDER: "fake",
      JEV_ENABLED: "true",
    } as Bindings
  );
  expect(await res.json()).toEqual({
    provider: "fake",
    jevEnabled: true,
    database: "perf_spark",
  });
});
