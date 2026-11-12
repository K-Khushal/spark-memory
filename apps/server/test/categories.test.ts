import { describe, expect, it } from "vitest";
import { databaseUrl, fakeTurnstile, signedIn } from "./worker";

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

    const ids = async (query: string) =>
      (
        (await (await call(`/api/search?q=tart${query}`)).json()) as {
          results: { id: string }[];
        }
      ).results.map((r) => r.id);
    expect(await ids("")).toEqual([saved.id]);
    expect(await ids("&categories=Recipe")).toEqual([saved.id]);
    expect(await ids("&categories=Video,Tutorial")).toEqual([saved.id]);
    expect(await ids("&categories=Video")).toEqual([]);
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
    for (const query of ["Invalid", "", "Recipe,Invalid"]) {
      expect(
        (await call(`/api/search?q=note&categories=${query}`)).status
      ).toBe(400);
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
