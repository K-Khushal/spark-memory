import { expect, it } from "vitest";
import { normaliseUrl, youtubeId, videoTimestamp } from "../index";
it("dedupes YouTube forms and keeps the Source moment separate", () => {
  expect(normaliseUrl("https://youtu.be/abcdefghijk?t=760&si=x")).toBe(
    "https://www.youtube.com/watch?v=abcdefghijk"
  );
  expect(normaliseUrl("https://www.youtube.com/watch?v=abcdefghijk&t=30")).toBe(
    "https://www.youtube.com/watch?v=abcdefghijk"
  );
  expect(
    videoTimestamp("https://youtube.com/watch?v=abcdefghijk&t=12m40s")
  ).toBe(760);
  expect(
    youtubeId("https://youtube.com.evil.test/watch?v=abcdefghijk")
  ).toBeUndefined();
});
