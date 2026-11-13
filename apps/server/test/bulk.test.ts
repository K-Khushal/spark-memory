import { describe, expect, it } from "vitest";
import { databaseUrl, fakeTurnstile, signedIn, files } from "./worker";
fakeTurnstile();
describe.skipIf(!databaseUrl)("Bulk Memories API", () => {
  it("sets and locks Categories atomically, scopes ids to the owner, and deletes idempotently", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    const capture = async (request: typeof call) =>
      (await (
        await request("/api/memories", {
          method: "POST",
          json: { body: "Bulk recipe" },
        })
      ).json()) as { id: string };
    const a = await capture(call),
      b = await capture(call),
      foreign = await capture(other.call);
    const ids = [a.id, b.id, foreign.id];
    const bulk = (json: unknown) =>
      call("/api/memories/bulk", { method: "POST", json });
    expect(
      (await bulk({ ids, operation: "categories", categories: ["Unknown"] }))
        .status
    ).toBe(400);
    expect(
      (
        await bulk({
          ids,
          operation: "categories",
          categories: ["Recipe", "Code", "Article", "Video"],
        })
      ).status
    ).toBe(400);
    expect(
      (
        await bulk({
          ids: [foreign.id],
          operation: "categories",
          categories: ["Unknown"],
        })
      ).status
    ).toBe(400);
    const set = await bulk({
      ids,
      operation: "categories",
      categories: ["Recipe"],
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({
      ids: expect.arrayContaining([a.id, b.id]),
    });
    for (const id of [a.id, b.id])
      expect(await (await call(`/api/memories/${id}`)).json()).toMatchObject({
        categories: ["Recipe"],
        categoriesLocked: true,
      });
    expect(
      await (await other.call(`/api/memories/${foreign.id}`)).json()
    ).toMatchObject({ categories: ["Other"], categoriesLocked: false });
    for (let n = 0; n < 2; n++)
      expect((await bulk({ ids, operation: "delete" })).status).toBe(200);
    expect((await call(`/api/memories/${a.id}`)).status).toBe(404);
    expect((await other.call(`/api/memories/${foreign.id}`)).status).toBe(200);
    expect(
      (await bulk({ ids: Array(201).fill(a.id), operation: "delete" })).status
    ).toBe(400);
  });
});

// Both public boundaries share the production lock path against real Postgres.
it.skipIf(!databaseUrl)(
  "orders bulk Category writes with Indexing, rename and deletion without deadlocks",
  async () => {
    const { openDatabase, indexingStore, openCategories } =
      await import("@spark/db");
    const { db, close } = openDatabase(databaseUrl!);
    try {
      const { call } = await signedIn();
      const store = indexingStore(db);
      for (let n = 0; n < 12; n++) {
        const saved = (await (
          await call("/api/memories", {
            method: "POST",
            json: { body: "Race recipe" },
          })
        ).json()) as { id: string };
        const partner = (await (
          await call("/api/memories", {
            method: "POST",
            json: { body: "Race partner" },
          })
        ).json()) as { id: string };
        const loaded = (await store.load(saved.id))!;
        const categories = openCategories(db, loaded.userId);
        const made = await categories.create(`Batch ${n}`);
        if (!("category" in made)) throw new Error("Category creation");
        const responses = await Promise.all([
          call("/api/memories/bulk", {
            method: "POST",
            json: {
              ids: [partner.id, saved.id],
              operation: "categories",
              categories: ["Recipe"],
            },
          }),
          store.writeCategories(
            { ...loaded, memoryId: saved.id },
            loaded.revision,
            ["Article"],
            loaded.categoriesGeneration
          ),
          categories.rename(made.category.id, `Renamed ${n}`),
        ]);
        expect((responses[0] as Response).status).toBe(200);
        expect(
          await (await call(`/api/memories/${saved.id}`)).json()
        ).toMatchObject({ categories: ["Recipe"], categoriesLocked: true });
        const deletion = await Promise.all([
          call("/api/memories/bulk", {
            method: "POST",
            json: {
              ids: [saved.id, partner.id],
              operation: "categories",
              categories: ["Code"],
            },
          }),
          call("/api/memories/bulk", {
            method: "POST",
            json: { ids: [partner.id, saved.id], operation: "delete" },
          }),
          store.writeCategories(
            { ...loaded, memoryId: saved.id },
            loaded.revision,
            ["Article"],
            loaded.categoriesGeneration
          ),
        ]);
        expect((deletion[0] as Response).status).toBe(200);
        expect((deletion[1] as Response).status).toBe(200);
      }
    } finally {
      await close();
    }
  }
);

it.skipIf(!databaseUrl)(
  "removes stored files immediately after the delete commits",
  async () => {
    const { call } = await signedIn();
    const res = await call("/api/memories/images", {
      method: "POST",
      json: {
        id: crypto.randomUUID(),
        mime: "image/png",
        bytes: 12,
        width: 640,
        height: 480,
        contentHash: "ef".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 6 },
      },
    });
    const saved = (await res.json()) as {
      memory: { id: string };
      uploads: { url: string; role: string }[];
    };
    expect(res.status).toBe(201);
    const keys: string[] = [];
    for (const slot of saved.uploads) {
      const key = new URL(slot.url, "http://localhost:8787").pathname.split(
        "/local-files/"
      )[1]!;
      keys.push(key);
      await files.put(key, new ArrayBuffer(slot.role === "original" ? 12 : 6), {
        httpMetadata: {
          contentType: slot.role === "original" ? "image/png" : "image/webp",
          cacheControl: "",
        },
      });
    }
    expect(
      (
        await call(`/api/memories/${saved.memory.id}/stored`, {
          method: "POST",
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call("/api/memories/bulk", {
          method: "POST",
          json: { ids: [saved.memory.id], operation: "delete" },
        })
      ).status
    ).toBe(200);
    expect(keys.filter((key) => files.objects.has(key))).toEqual([]);
  }
);
