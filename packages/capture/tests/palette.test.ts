import { describe, expect, it } from "vitest";
import { dominantColours } from "../index";

/** RGBA pixels: `count` of each colour. */
const pixels = (...runs: [[number, number, number, number], number][]) =>
  runs.flatMap(([rgba, count]) =>
    Array.from({ length: count }, () => rgba).flat()
  );

describe("dominant colours", () => {
  it("orders colours by how much of the image they cover", () => {
    expect(
      dominantColours(pixels([[255, 136, 0, 255], 30], [[17, 34, 51, 255], 60]))
    ).toEqual(["#112233", "#ff8800"]);
  });

  it("merges near shades, skips tiny details and transparent pixels", () => {
    expect(
      dominantColours(
        pixels(
          [[200, 0, 0, 255], 50],
          [[210, 10, 10, 255], 40],
          [[0, 0, 255, 255], 1],
          [[0, 255, 0, 0], 500]
        )
      )
    ).toEqual(["#c80000"]);
  });

  it("keeps at most `max` colours and handles an empty image", () => {
    const many = pixels(
      ...[0, 64, 128, 192, 255].flatMap((r) =>
        [0, 255].map(
          (b) =>
            [[r, 0, b, 255], 10] as [[number, number, number, number], number]
        )
      )
    );
    expect(dominantColours(many, 3)).toHaveLength(3);
    expect(dominantColours([])).toEqual([]);
  });
});
