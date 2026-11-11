import { describe, expect, it } from "vitest";
import { draftStore, withRefused } from "./drafts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const fields = { title: "T", body: "Long text", captureNote: "" };

describe("stored pending edits", () => {
  it("keeps an edit, with its revision and page, until discarded", () => {
    const drafts = draftStore(memoryStorage(), "p1");
    expect(drafts.page).toBe("p1");
    const edit = { fields, baseRevision: 3, page: "p1" };
    drafts.keep("m1", edit);
    expect(drafts.read("m1")).toEqual({ ...edit, refused: undefined });
    drafts.discard("m1");
    expect(drafts.read("m1")).toBeUndefined();
  });

  it("does nothing, without throwing, when storage is blocked or full", () => {
    const drafts = draftStore(blocked);
    expect(() =>
      drafts.keep("m1", { fields, baseRevision: 1, page: "p1" })
    ).not.toThrow();
    expect(drafts.read("m1")).toBeUndefined();
    expect(() => drafts.discard("m1")).not.toThrow();
  });

  it("reads a legacy single refused draft as a one-item list", () => {
    const storage = memoryStorage();
    storage.setItem(
      "spark-draft:m1",
      JSON.stringify({
        fields,
        baseRevision: 1,
        refused: { title: "Old", body: "B", captureNote: "" },
        page: "p1",
      })
    );
    expect(draftStore(storage).read("m1")?.refused).toEqual([
      { title: "Old", body: "B", captureNote: "" },
    ]);
  });

  it("keeps three refused versions, newest first, without duplicates", () => {
    const a = { title: "A", body: "x", captureNote: "" };
    const b = { title: "B", body: "x", captureNote: "" };
    const c = { title: "C", body: "x", captureNote: "" };
    const d = { title: "D", body: "x", captureNote: "" };
    expect(withRefused(withRefused(withRefused([a], b), c), d)).toEqual([
      d,
      c,
      b,
    ]);
    expect(withRefused([b, a], a)).toEqual([a, b]);
  });

  it("ignores a stored value that is not a pending edit", () => {
    const storage = memoryStorage();
    storage.setItem("spark-draft:m1", "{not json");
    storage.setItem("spark-draft:m2", JSON.stringify({ ...fields }));
    storage.setItem(
      "spark-draft:m3",
      JSON.stringify({ baseRevision: 1, page: "p1" })
    );
    const drafts = draftStore(storage);
    for (const id of ["m1", "m2", "m3"]) {
      expect(drafts.read(id), id).toBeUndefined();
    }
  });
});
