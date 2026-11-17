import { describe, expect, it } from "vitest";
import {
  columnCount,
  neighbour,
  tabStop,
  wallChange,
  type LaneItem,
} from "../layout";

describe("columnCount", () => {
  it("fits as many columns of at least the minimum width as it can", () => {
    // 3 × 200 + 2 × 16 = 632 fits in 640; 4 columns would need 848.
    expect(columnCount(640, { minWidth: 200, gap: 16 })).toBe(3);
  });

  it("never returns fewer than one column", () => {
    expect(columnCount(120, { minWidth: 200, gap: 16 })).toBe(1);
    expect(columnCount(0, { minWidth: 200, gap: 16 })).toBe(1);
  });

  it("respects a maximum", () => {
    expect(columnCount(4000, { minWidth: 200, gap: 16, max: 6 })).toBe(6);
  });
});

describe("neighbour", () => {
  // Two lanes:   lane 0      lane 1
  //              0 [0,100)   1 [0,300)
  //              2 [110,210)
  //              3 [220,520) 4 [310,410)
  const items: LaneItem[] = [
    { index: 0, lane: 0, start: 0, size: 100 },
    { index: 1, lane: 1, start: 0, size: 300 },
    { index: 2, lane: 0, start: 110, size: 100 },
    { index: 3, lane: 0, start: 220, size: 300 },
    { index: 4, lane: 1, start: 310, size: 100 },
  ];

  it("moves up and down within a lane", () => {
    expect(neighbour(items, 0, "ArrowDown")).toBe(2);
    expect(neighbour(items, 3, "ArrowUp")).toBe(2);
    expect(neighbour(items, 1, "ArrowDown")).toBe(4);
  });

  it("moves sideways to the item whose centre is nearest", () => {
    expect(neighbour(items, 2, "ArrowRight")).toBe(1);
    expect(neighbour(items, 4, "ArrowLeft")).toBe(3);
  });

  it("stops at the edges", () => {
    expect(neighbour(items, 0, "ArrowUp")).toBeUndefined();
    expect(neighbour(items, 0, "ArrowLeft")).toBeUndefined();
    expect(neighbour(items, 1, "ArrowRight")).toBeUndefined();
    expect(neighbour(items, 3, "ArrowDown")).toBeUndefined();
  });

  it("ignores keys that do not move", () => {
    expect(neighbour(items, 0, "Enter")).toBeUndefined();
  });
});

describe("tabStop", () => {
  it("keeps the active item when it is rendered", () => {
    expect(tabStop(4, [2, 3, 4, 5])).toBe(4);
  });

  it("falls back to the first rendered item when the active one is gone", () => {
    // Filtered down to 3 items after moving to index 5.
    expect(tabStop(5, [0, 1, 2])).toBe(0);
    // Virtualisation unmounted the active tile.
    expect(tabStop(0, [12, 13, 14])).toBe(12);
  });

  it("has no tab stop when nothing is rendered", () => {
    expect(tabStop(0, [])).toBeUndefined();
  });
});

describe("wallChange", () => {
  it("is none for the same keys in the same order", () => {
    expect(wallChange(["a", "b"], ["a", "b"]).kind).toBe("none");
  });

  it("is a reorder for the same keys in a new order", () => {
    expect(wallChange(["a", "b"], ["b", "a"]).kind).toBe("reorder");
  });

  it("is an edit, naming what is new, when a key is inserted or removed", () => {
    const insert = wallChange(["a", "b"], ["n", "a", "b"]);
    expect(insert.kind).toBe("edit");
    expect([...insert.added]).toEqual(["n"]);
    const remove = wallChange(["a", "b", "c"], ["b", "c"]);
    expect(remove.kind).toBe("edit");
    expect(remove.added.size).toBe(0);
  });

  it("calls the first fill of an empty wall nothing", () => {
    expect(wallChange([], ["a", "b"])).toEqual({
      kind: "none",
      added: new Set(),
    });
  });
});
