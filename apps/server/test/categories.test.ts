import { describe, expect, it } from "vitest";
import { databaseUrl, fakeTurnstile, postSearch, signedIn } from "./worker";

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
});
