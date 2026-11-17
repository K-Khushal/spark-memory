/** @vitest-environment happy-dom */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bodyLines,
  estimate,
  titleFonts,
  titleLines,
  wrapLines,
} from "./title-lines";

// A monospace stand-in for the canvas: ten pixels a character.
const mono = (text: string) => text.length * 10;

describe("wrapLines", () => {
  it("keeps a short title on one line, so no empty second line is reserved", () => {
    expect(wrapLines("How Plants Follow", 300, mono)).toBe(1);
    expect(wrapLines("", 300, mono)).toBe(1);
  });

  it("wraps greedily at word edges, as the browser does", () => {
    // "hello world" is 110px: "hello" fills a line and "world foo" the next.
    expect(wrapLines("hello world foo", 100, mono)).toBe(2);
    expect(wrapLines("hello world", 110, mono)).toBe(1);
    // A trailing space hangs past the edge; it never starts a line.
    expect(wrapLines("hello ", 50, mono)).toBe(1);
  });

  it("stops at two lines however long the title is", () => {
    const long = "word ".repeat(40).trim();
    expect(wrapLines(long, 100, mono)).toBe(2);
    expect(wrapLines(long, 100, mono, 3)).toBe(3);
  });

  it("breaks a word wider than the line where it must", () => {
    expect(wrapLines("a".repeat(20), 100, mono)).toBe(2);
    expect(wrapLines("a".repeat(10), 100, mono)).toBe(1);
  });

  it("wraps text with no spaces between its characters", () => {
    expect(wrapLines("日本語のデザイン資料メモ", 70, estimate(10))).toBe(2);
    expect(wrapLines("नमस्ते", 400, estimate(10))).toBe(1);
  });
});

describe("titleLines once the font has loaded", () => {
  // A canvas whose glyphs are 20px ("W"), 4px ("i") or 10px (the rest).
  const glyph = (c: string) => (c === "W" ? 20 : c === "i" ? 4 : 10);
  beforeAll(async () => {
    vi.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          getContext: () => ({
            font: "",
            measureText: (text: string) => ({
              width: [...text].reduce((n, c) => n + glyph(c), 0),
            }),
          }),
        }) as never
    );
    titleFonts.markLoaded();
  });
  afterAll(() => vi.restoreAllMocks());

  it("measures body glyphs, preserved paragraphs, normal whitespace and clamping", () => {
    expect(bodyLines("WWWWWW", 100, 12)).toBe(2);
    expect(bodyLines("iiiiii", 100, 12)).toBe(1);
    expect(bodyLines("hello\n\nworld\n", 100, 12)).toBe(3);
    expect(bodyLines("hello\n\nworld\n", 200, 12, false)).toBe(1);
    expect(bodyLines("WWWWWW", 30, 2)).toBe(2);
  });

  it("sends wide glyphs to a second line that an average width would leave on one", () => {
    // 12 W's are 240px: past a 200px line, though 12 characters "should" fit.
    expect(titleLines("W".repeat(12), 200, 17)).toBe(2);
    expect(titleLines("W".repeat(8), 200, 17)).toBe(1);
  });

  it("keeps narrow glyphs on one line that an average width would wrap", () => {
    // 60 i's are 240px, but as a long word they wrap by character: 2 lines
    // at 200px, and 1 once the line is wide enough.
    expect(titleLines("i".repeat(60), 300, 17)).toBe(1);
    expect(titleLines("i".repeat(60), 200, 17)).toBe(2);
    // Words of i's: 30 of them with spaces are 30*4 + 29*10.
    expect(titleLines("iii ".repeat(20).trim(), 600, 17)).toBe(1);
  });
});
