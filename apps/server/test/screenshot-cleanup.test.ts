import { describe, expect, it } from "vitest";
import { Client } from "pg";
import worker from "../src/index";
import {
  ctx,
  databaseUrl,
  env,
  fakeTurnstile,
  files,
  signedIn,
} from "./worker";

fakeTurnstile();
describe.skipIf(!databaseUrl)("screenshot failures", () => {
  for (const failure of ["record", "refusal"] as const) {
    it(`keeps durable cleanup when ${failure} fails after upload`, async () => {
      const { call } = await signedIn();
      const res = await call("/api/memories/links", {
        method: "POST",
        json: { url: `https://garden.test/${crypto.randomUUID()}` },
      });
      const { id } = (await res.json()) as { id: string };
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let key = "";
      const bindings = env({
        FILES: {
          ...files,
          put: async (k, body, options) => {
            key = k;
            await files.put(k, body, options);
            if (failure === "refusal")
              await call(`/api/memories/${id}`, { method: "DELETE" });
          },
          delete: async () => {
            throw new Error("storage unavailable");
          },
        },
      });
      try {
        if (failure === "record")
          await client.query(
            `ALTER TABLE memory_file ADD CONSTRAINT screenshot_test_failure CHECK (memory_id <> '${id}')`
          );
        const response = await worker.fetch(
          new Request(`http://localhost:8787/api/memories/${id}/screenshot`, {
            method: "POST",
            headers: {
              origin: "http://localhost:8787",
              cookie: call.cookie(),
              "content-type": "image/jpeg",
            },
            body: new Uint8Array([255, 216, 255, 217]),
          }),
          bindings,
          ctx
        );
        expect(response.status).toBe(500);
        expect(files.objects.has(key)).toBe(true);
        const pending = await client.query(
          "SELECT key, due_at > now() as future FROM object_removal WHERE key = $1",
          [key]
        );
        expect(pending.rows).toEqual([{ key, future: true }]);
      } finally {
        if (failure === "record")
          await client.query(
            "ALTER TABLE memory_file DROP CONSTRAINT screenshot_test_failure"
          );
        await client.end();
      }
    });
  }
});
