import { describe, expect, it } from "vitest";
import { renamedIn, withoutIn } from "./category-wall";

const memories = [
  { id: "a", categories: ["Recipe", "Gardening"] },
  { id: "b", categories: ["Gardening"] },
  { id: "c", categories: ["Code"] },
];

describe("the wall after a Category changes", () => {
  it("renames it wherever it is, in place, leaving the rest", () => {
    const next = renamedIn(memories, "Gardening", "Plant Care");
    expect(next.map((m) => m.categories)).toEqual([
      ["Recipe", "Plant Care"],
      ["Plant Care"],
      ["Code"],
    ]);
    // A Memory that did not have it is the same object, so nothing re-renders for it.
    expect(next[2]).toBe(memories[2]);
  });

  it("takes it off, and a Memory left with none is Other", () => {
    expect(withoutIn(memories, "Gardening").map((m) => m.categories)).toEqual([
      ["Recipe"],
      ["Other"],
      ["Code"],
    ]);
  });
});
