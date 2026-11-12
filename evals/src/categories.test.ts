import { describe, expect, it } from "vitest";
import { loadCategoryLabels, scoreCategories } from "./categories";
import { loadSet } from "./manifest";

describe("Category labels", () => {
  it("name sample Memories that exist", async () => {
    const ids = new Set((await loadSet()).memories.map((m) => m.id));
    const labels = await loadCategoryLabels();
    expect(Object.keys(labels).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(labels).length).toBeGreaterThan(50);
  });

  it("scores the first Category and all of them", () => {
    const labels = {
      a: ["Recipe", "Article"],
      b: ["Code"],
      c: ["Place"],
    } as const;
    const score = scoreCategories(
      { a: [...labels.a], b: [...labels.b], c: [...labels.c] },
      new Map([
        ["a", ["Recipe", "Video"]],
        ["b", ["Article", "Code"]],
      ])
    );
    expect(score).toEqual({ labelled: 3, first: 1, all: 0 });
    expect(
      scoreCategories(
        { a: ["Recipe", "Article"] },
        new Map([["a", ["Article", "Recipe"]]])
      )
    ).toEqual({ labelled: 1, first: 1, all: 1 });
  });
});
