import { expect, it } from "vitest";
import { selectionCapture, videoSource, cropRect } from "../lib/capture";
it("keeps selected text, context and an escaped text-fragment Source", () => {
  expect(
    selectionCapture(
      "https://example.com/p#old",
      "A-B & C",
      "Before A-B & C after",
      "Title"
    )
  ).toMatchObject({
    body: "A-B & C",
    source: {
      url: "https://example.com/p#old:~:text=A%2DB%20%26%20C",
      context: "Before A-B & C after",
    },
  });
});
it("anchors YouTube playback without changing other Sources", () => {
  expect(videoSource("https://www.youtube.com/watch?v=abc", 83.9)).toBe(
    "https://www.youtube.com/watch?v=abc&t=83s"
  );
  expect(videoSource("https://example.com", 83)).toBe("https://example.com");
});
it("crops reverse drags in screenshot pixels and refuses empty regions", () => {
  expect(
    cropRect({ x: 90, y: 80 }, { x: 10, y: 20 }, 100, 100, 200, 300)
  ).toEqual({ x: 20, y: 60, width: 160, height: 180 });
  expect(() =>
    cropRect({ x: 0, y: 0 }, { x: 0, y: 0 }, 100, 100, 200, 200)
  ).toThrow();
});
it("disambiguates repeated selected text with surrounding text-fragment context", () => {
  expect(
    selectionCapture("https://example.com/p", "Basil", "Then Basil grows", "", {
      prefix: "Then ",
      suffix: " grows",
    }).source?.url
  ).toBe("https://example.com/p#:~:text=Then-,Basil,-grows");
});
it("preserves hash-router locations while replacing an old text directive", () => {
  for (const url of [
    "https://example.com/app/#/notes/42",
    "https://example.com/app/#/notes/42:~:text=old",
  ])
    expect(selectionCapture(url, "Basil", "", "").source?.url).toBe(
      "https://example.com/app/#/notes/42:~:text=Basil"
    );
});
it("only anchors YouTube video Sources, never channels, home, or shorts", () => {
  for (const url of [
    "https://youtube.com/",
    "https://youtube.com/@basil",
    "https://youtube.com/shorts/abc",
    "https://youtube.com/watch",
    "https://youtu.be/",
  ])
    expect(videoSource(url, 42)).toBe(url);
  expect(videoSource("https://youtu.be/abc", 42)).toBe(
    "https://youtu.be/abc?t=42s"
  );
});
