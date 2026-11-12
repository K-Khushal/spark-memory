import { expect, it } from "vitest";
import { whyLabel } from "./why";
it("names the spoken moment, including the start of a video", () => {
  expect(
    whyLabel({
      kind: "video",
      body: "Plants",
      part: { kind: "passage", field: "body", start: 0, end: 6, seconds: 760 },
    })
  ).toBe("Said at 12:40");
  expect(
    whyLabel({
      kind: "video",
      body: "Plants",
      part: { kind: "passage", field: "body", start: 0, end: 6, seconds: 0 },
    })
  ).toBe("Said at 0:00");
});
