import { expect, it } from "vitest";
import {
  formatTimestamp,
  normaliseUrl,
  youtubeId,
  videoTimestamp,
} from "../index";
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

it("writes a moment as minutes and seconds, with hours from an hour on", () => {
  expect(formatTimestamp(0)).toBe("0:00");
  expect(formatTimestamp(760)).toBe("12:40");
  expect(formatTimestamp(3599.9)).toBe("59:59");
  expect(formatTimestamp(3600)).toBe("1:00:00");
  expect(formatTimestamp(7384)).toBe("2:03:04");
});
