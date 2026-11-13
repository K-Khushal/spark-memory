import { describe, expect, it } from "vitest";
import {
  databaseUrl,
  drain,
  fakeTurnstile,
  postSearch,
  queues,
  signedIn,
} from "./worker";

fakeTurnstile();

describe.skipIf(!databaseUrl)("Categories API", () => {
  it("edits and locks Categories, and filters search by them", async () => {
    const { call } = await signedIn();
    const saved = (await (
      await call("/api/memories", {
        method: "POST",
        json: { body: "Lemon tart recipe" },
      })
    ).json()) as { id: string; revision: number };
    expect(saved).toMatchObject({
      categories: ["Other"],
      categoriesLocked: false,
    });

    const edit = await call(`/api/memories/${saved.id}`, {
      method: "PATCH",
      json: { categories: ["Recipe", "Tutorial"], revision: saved.revision },
    });
    expect(await edit.json()).toMatchObject({
      categories: ["Recipe", "Tutorial"],
      categoriesLocked: true,
      revision: saved.revision,
    });

    const ids = async (body: Record<string, unknown>) =>
      (
        (await (await postSearch(call, body)).json()) as {
          results: { id: string }[];
        }
      ).results.map((r) => r.id);
    expect(await ids({ q: "tart" })).toEqual([saved.id]);
    expect(await ids({ q: "tart", chips: { category: "Recipe" } })).toEqual([
      saved.id,
    ]);
    // Browsing by a Category alone, with no words.
    expect(await ids({ chips: { category: "Tutorial" } })).toEqual([saved.id]);
    expect(await ids({ q: "tart", chips: { category: "Video" } })).toEqual([]);
    expect(await ids({ chips: { category: "Video" } })).toEqual([]);
  });

  it("refuses invalid Categories", async () => {
    const { call } = await signedIn();
    const saved = (await (
      await call("/api/memories", { method: "POST", json: { body: "A note" } })
    ).json()) as { id: string };
    for (const categories of [
      [],
      ["Invalid"],
      ["Recipe", "Recipe"],
      ["Recipe", "Code", "Article", "Video"],
    ]) {
      const res = await call(`/api/memories/${saved.id}`, {
        method: "PATCH",
        json: { categories },
      });
      expect(res.status).toBe(400);
    }
    for (const category of ["Invalid", "", "recipe", ["Recipe"]]) {
      const res = await postSearch(call, { q: "note", chips: { category } });
      expect(res.status).toBe(400);
    }
  });

  it("keeps another person's Memory out of reach", async () => {
    const { call } = await signedIn();
    const saved = (await (
      await call("/api/memories", { method: "POST", json: { body: "Mine" } })
    ).json()) as { id: string };
    const other = await signedIn();
    const res = await other.call(`/api/memories/${saved.id}`, {
      method: "PATCH",
      json: { categories: ["Video"] },
    });
    expect(res.status).toBe(404);
    expect(
      await (await call(`/api/memories/${saved.id}`)).json()
    ).toMatchObject({
      categories: ["Other"],
      categoriesLocked: false,
    });
  });

  describe("own Categories", () => {
    type State = {
      categories: { id: string; name: string; memories: number }[];
      run?: { done: number; total: number };
    };
    const state = async (call: Awaited<ReturnType<typeof signedIn>>["call"]) =>
      (await (await call("/api/categories")).json()) as State;
    const make = (
      call: Awaited<ReturnType<typeof signedIn>>["call"],
      name: string
    ) => call("/api/categories", { method: "POST", json: { name } });

    it("creates, renames and deletes, and answers with the whole list each time", async () => {
      const { call } = await signedIn();
      expect(await state(call)).toEqual({ categories: [] });
      const created = await make(call, "Gardening");
      expect(created.status).toBe(201);
      const { categories } = (await created.json()) as State;
      expect(categories).toMatchObject([{ name: "Gardening", memories: 0 }]);
      const id = categories[0]!.id;

      const renamed = await call(`/api/categories/${id}`, {
        method: "PATCH",
        json: { name: "Plant Care" },
      });
      expect(((await renamed.json()) as State).categories[0]!.name).toBe(
        "Plant Care"
      );
      const removed = await call(`/api/categories/${id}`, { method: "DELETE" });
      expect(await removed.json()).toEqual({ categories: [] });
      expect(
        (await call(`/api/categories/${id}`, { method: "DELETE" })).status
      ).toBe(404);
    });

    it("refuses a bad name with the reason, and anything not a name", async () => {
      const { call } = await signedIn();
      await make(call, "Gardening");
      for (const [name, problem] of [
        ["gardening", "duplicate"],
        ["Recipe", "duplicate"],
        ["recipe", "duplicate"],
        ["home lab", "case"],
        ["   ", "empty"],
        ["x".repeat(41), "long"],
      ] as const) {
        const res = await make(call, name);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          ok: false,
          error: "invalid_name",
          problem,
        });
      }
      for (const json of [{}, { name: 3 }, { name: "A", extra: 1 }]) {
        const res = await call("/api/categories", { method: "POST", json });
        expect(res.status).toBe(400);
      }
      expect(
        (await call("/api/categories/nope", { method: "DELETE" })).status
      ).toBe(404);
    });

    it("uses an own Category on a Memory and in search, for its owner only", async () => {
      const { call } = await signedIn();
      const other = await signedIn();
      await make(call, "Gardening");
      await make(other.call, "Gardening");
      const saved = (await (
        await call("/api/memories", {
          method: "POST",
          json: { body: "Tomato beds" },
        })
      ).json()) as { id: string };
      const edit = await call(`/api/memories/${saved.id}`, {
        method: "PATCH",
        json: { categories: ["Gardening"] },
      });
      expect(await edit.json()).toMatchObject({
        categories: ["Gardening"],
        categoriesLocked: true,
      });
      const ids = async (who: typeof call, body: Record<string, unknown>) =>
        (
          (await (await postSearch(who, body)).json()) as {
            results: { id: string }[];
          }
        ).results.map((r) => r.id);
      expect(await ids(call, { chips: { category: "Gardening" } })).toEqual([
        saved.id,
      ]);
      expect(
        await ids(other.call, { chips: { category: "Gardening" } })
      ).toEqual([]);
      expect((await state(call)).categories[0]).toMatchObject({ memories: 1 });

      // A name that is not theirs is refused, never searched.
      const none = await signedIn();
      expect(
        (await postSearch(none.call, { chips: { category: "Gardening" } }))
          .status
      ).toBe(400);
      expect(
        (
          await none.call(`/api/memories/${saved.id}`, {
            method: "PATCH",
            json: { categories: ["Gardening"] },
          })
        ).status
      ).toBe(404);
      const mine = (await (
        await none.call("/api/memories", {
          method: "POST",
          json: { body: "x" },
        })
      ).json()) as { id: string };
      const refused = await none.call(`/api/memories/${mine.id}`, {
        method: "PATCH",
        json: { categories: ["Gardening"] },
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        ok: false,
        error: "unknown_category",
      });
    });

    it("never lists another person's Categories or touches them", async () => {
      const a = await signedIn();
      const b = await signedIn();
      const { categories } = (await (
        await make(a.call, "Gardening")
      ).json()) as State;
      expect((await state(b.call)).categories).toEqual([]);
      const id = categories[0]!.id;
      expect(
        (
          await b.call(`/api/categories/${id}`, {
            method: "PATCH",
            json: { name: "Mine" },
          })
        ).status
      ).toBe(404);
      expect(
        (await b.call(`/api/categories/${id}`, { method: "DELETE" })).status
      ).toBe(404);
      expect((await state(a.call)).categories).toHaveLength(1);
    });

    it("re-categorises unlocked Memories in the background and shows progress", async () => {
      const { call } = await signedIn();
      const capture = async (body: string) =>
        (await (
          await call("/api/memories", { method: "POST", json: { body } })
        ).json()) as { id: string; revision: number };
      const unlocked = await capture("gardening gardening tomato beds");
      const locked = await capture("gardening gardening roses");
      await drain(unlocked.id);
      await drain(locked.id);
      await call(`/api/memories/${locked.id}`, {
        method: "PATCH",
        json: { categories: ["Quote"] },
      });
      queues.background.sent.length = 0;

      const created = await make(call, "Gardening");
      expect(((await created.json()) as State).run).toEqual({
        done: 0,
        total: 1,
      });
      // One embed job, on the background queue, for the unlocked Memory only.
      expect(queues.background.sent.map((m) => m.body)).toMatchObject([
        { memoryId: unlocked.id, task: "embed", priority: "background" },
      ]);
      expect(
        queues.fresh.sent.some((m) => m.body.memoryId === unlocked.id)
      ).toBe(false);
      await drain(unlocked.id);
      const get = async (id: string) =>
        (await (await call(`/api/memories/${id}`)).json()) as {
          categories: string[];
        };
      expect((await get(unlocked.id)).categories).toContain("Gardening");
      expect((await get(locked.id)).categories).toEqual(["Quote"]);
      expect((await state(call)).run).toBeUndefined();
    });
  });
});
