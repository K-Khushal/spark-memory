import { describe, expect, it } from "vitest";
import { estimate, wrapLines } from "./title-lines";

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
