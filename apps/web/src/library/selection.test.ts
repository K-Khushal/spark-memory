import { describe, expect, it } from "vitest";
import { select, emptySelection } from "./selection";

describe("Wall selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("toggles ids and extends from the anchor in wall order, including off-screen ids", () => {
    let s = select(emptySelection, order, { type: "toggle", id: "b" });
    s = select(s, order, { type: "range", id: "e" });
    expect(s.ids).toEqual(["b", "c", "d", "e"]);
    s = select(s, order, { type: "range", id: "c" });
    expect(s.ids).toEqual(["b", "c"]);
    expect(select(s, order, { type: "toggle", id: "b" }).ids).toEqual(["c"]);
  });
});

it("selects all off-screen ids, merges marquee hits, and clears", () => {
  const order = ["a", "b", "c", "d"];
  const all = select(emptySelection, order, { type: "all" });
  expect(all.ids).toEqual(["a", "b", "c", "d"]);
  const marquee = select(all, order, {
    type: "marquee",
    ids: ["d", "b", "missing"],
    additive: ["a"],
  });
  expect(marquee.ids).toEqual(["a", "b", "d"]);
  expect(select(marquee, order, { type: "clear" })).toEqual(emptySelection);
});
it("uses the clicked id when an anchor disappeared", () => {
  expect(
    select({ ids: ["gone"], anchor: "gone" }, ["a", "b"], {
      type: "range",
      id: "b",
    }).ids
  ).toEqual(["b"]);
});
