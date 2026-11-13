import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { accountJobs, openDatabase } from "@spark/db";
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
      const { db, close } = openDatabase(databaseUrl!);
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
        expect(response.status).toBe(failure === "refusal" ? 503 : 500);
        if (failure === "refusal")
          expect(await response.json()).toEqual({
            ok: false,
            error: "unavailable",
          });
        expect(files.objects.has(key)).toBe(true);
        // Cleanup must leave a live upload alone, then reclaim the object
        // after its window, including when the request's delete failed.
        const sweep = () =>
          accountJobs(db).sweepExports((keys) => files.delete(keys));
        await sweep();
        expect(files.objects.has(key)).toBe(true);
        await client.query(
          "UPDATE object_removal SET due_at = now() - interval '1 second' WHERE key = $1",
          [key]
        );
        await sweep();
        expect(files.objects.has(key)).toBe(false);
      } finally {
        if (failure === "record")
          await client.query(
            "ALTER TABLE memory_file DROP CONSTRAINT screenshot_test_failure"
          );
        await client.end();
        await close();
      }
    });
  }
});
