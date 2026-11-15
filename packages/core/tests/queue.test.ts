import { describe, expect, it } from "vitest";
import { queueDelaySeconds } from "../index";

describe("queue delay", () => {
  it.each([
    [86400, 43200],
    [43200, 43200],
    [-1, 0],
    [1.2, 2],
    [0, 0],
  ])("bounds %s seconds to %s", (input, expected) => {
    expect(queueDelaySeconds(input)).toBe(expected);
  });
});
