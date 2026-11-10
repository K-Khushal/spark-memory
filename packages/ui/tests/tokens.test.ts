import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, THEMES, type ThemeName } from "../tokens";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** The declarations inside the first block that opens with `selector {`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in styles.css`);
  return css.slice(start, css.indexOf("}", start));
}

const SELECTORS: Record<ThemeName, string> = {
  light: ":root",
  dark: '[data-theme="dark"]',
};

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#ffffff", "#767676")).toBeCloseTo(
      contrastRatio("#767676", "#ffffff"),
      6
    );
  });
});

describe.each(Object.keys(THEMES) as ThemeName[])("%s theme", (name) => {
  const t = THEMES[name];

  it("matches the CSS custom properties in styles.css", () => {
    const declared = block(SELECTORS[name]);
    for (const [token, value] of Object.entries(t)) {
      // Prettier lowercases hex in CSS, so compare case-insensitively.
      expect(declared.toLowerCase()).toContain(
        `--${token}: ${value.toLowerCase()};`
      );
    }
  });

  it.each([
    ["ink", "canvas"],
    ["ink", "surface"],
    ["ink-muted", "canvas"],
    ["ink-muted", "surface"],
    ["on-spark", "spark"],
    ["danger", "surface"],
    ["indexing", "surface"],
  ] as const)("%s on %s reads at WCAG AA (4.5:1)", (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["ring", "canvas"],
    ["ring", "surface"],
    ["line-strong", "surface"],
  ] as const)("%s on %s is visible as a UI boundary (3:1)", (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
