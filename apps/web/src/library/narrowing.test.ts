import { describe, expect, it } from "vitest";
import { narrowing } from "./narrowing";

const note = (...categories: string[]) =>
  ({ kind: "text", categories }) as Parameters<typeof narrowing>[0][number];
const image = (...categories: string[]) =>
  ({ kind: "image", categories }) as Parameters<typeof narrowing>[0][number];

describe("narrowing", () => {
  it("offers the kinds and Categories that only some of the Related Matches have", () => {
    expect(
      narrowing([note("Recipe"), image("Recipe", "Screenshot")], {})
    ).toEqual({ kinds: ["image", "note"], categories: ["Screenshot"] });
  });

  it("offers the person's own Categories after the built-ins", () => {
    expect(
      narrowing([note("Gardening", "Idea"), image("Recipe"), note("Idea")], {})
    ).toEqual({
      kinds: ["image", "note"],
      categories: ["Recipe", "Idea", "Gardening"],
    });
  });

  it("offers nothing that every result has, since it would narrow nothing", () => {
    expect(narrowing([note("Recipe"), note("Recipe")], {})).toEqual({
      kinds: [],
      categories: [],
    });
    expect(narrowing([note("Idea")], {})).toEqual({
      kinds: [],
      categories: [],
    });
  });

  it("leaves out what is already chosen and Other", () => {
    expect(
      narrowing([note("Other"), image("Other", "Recipe")], {
        kind: "image",
        category: "Recipe",
      })
    ).toEqual({ kinds: ["note"], categories: [] });
  });

  it("drops a Category that a kind chip already says, singular or plural", () => {
    const video = (...categories: string[]) =>
      ({ kind: "video", categories }) as Parameters<
        typeof narrowing
      >[0][number];
    expect(
      narrowing([video("Video"), note("Idea", "Video"), note("Idea")], {})
    ).toEqual({ kinds: ["video", "note"], categories: ["Idea"] });
  });
});
