import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  EASING,
  NEUTRAL_TOKENS,
  oklch,
  RADIUS,
  TYPE_SCALE,
  THEMES,
  type ThemeName,
} from "../tokens";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(
  new URL("../../../apps/web/index.html", import.meta.url),
  "utf8"
);

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

describe("browser chrome", () => {
  it.each(Object.keys(THEMES) as ThemeName[])(
    "the %s theme-color in apps/web/index.html is the canvas token",
    (name) => {
      const meta = new RegExp(
        `media="\\(prefers-color-scheme: ${name}\\)"\\s+content="(#[0-9a-f]{6})"`,
        "i"
      ).exec(html);
      expect(meta?.[1]?.toLowerCase()).toBe(THEMES[name].canvas.toLowerCase());
    }
  );
});

/** The value of one custom property inside the first `@theme {` block. */
function themeValue(property: string): string {
  const match = new RegExp(`${property}: ([^;]+);`).exec(block("@theme"));
  if (!match) throw new Error(`No ${property} in the @theme block`);
  return match[1]!.trim();
}

describe("shape and motion tokens", () => {
  it.each(Object.entries(RADIUS))(
    "radius %s matches --radius-%s",
    (name, px) => {
      expect(themeValue(`--radius-${name}`)).toBe(`${px}px`);
    }
  );

  it.each(Object.entries(EASING))(
    "easing %s matches its CSS curve",
    (name, curve) => {
      const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(themeValue(`--ease-${kebab}`)).toBe(
        `cubic-bezier(${curve.join(", ")})`
      );
    }
  );

  it.each(Object.entries(TYPE_SCALE))(
    "type step %s matches --text-%s",
    (name, step) => {
      expect(themeValue(`--text-${name}`)).toBe(`${step.size / 16}rem`);
      expect(themeValue(`--text-${name}--line-height`)).toBe(
        `${step.leading / 16}rem`
      );
    }
  );

  it("declares no radius, easing or type step the tokens lack", () => {
    const theme = block("@theme");
    const names = (prefix: string) =>
      [
        ...theme.matchAll(
          new RegExp(`--${prefix}-([a-z0-9-]+?)(?:--line-height)?:`, "g")
        ),
      ]
        .map((m) => m[1]!)
        .filter((n) => n !== "*" && n !== "full");
    expect(new Set(names("radius"))).toEqual(new Set(Object.keys(RADIUS)));
    expect(new Set(names("text"))).toEqual(new Set(Object.keys(TYPE_SCALE)));
    expect(new Set(names("ease"))).toEqual(
      new Set(
        Object.keys(EASING).map((k) =>
          k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
        )
      )
    );
  });
});

describe("oklch", () => {
  it("has no chroma for greys and finds the hue of a colour", () => {
    expect(oklch("#808080").c).toBeLessThan(0.0005);
    const blue = oklch("#2f6fe0");
    expect(blue.h).toBeGreaterThan(250);
    expect(blue.h).toBeLessThan(270);
  });
});

describe.each(Object.keys(THEMES) as ThemeName[])("%s theme", (name) => {
  const t = THEMES[name];

  // DESIGN.md → Principles: no cream, beige or paper. Neutrals are true
  // greys or carry a faint cool (blue) cast, never a warm one.
  it.each(NEUTRAL_TOKENS)("%s is a true or cool neutral", (token) => {
    const { c, h } = oklch(t[token]);
    expect(c, `${token} ${t[token]} chroma`).toBeLessThanOrEqual(0.012);
    if (c > 0.003) {
      expect(h, `${token} ${t[token]} hue`).toBeGreaterThanOrEqual(200);
      expect(h, `${token} ${t[token]} hue`).toBeLessThanOrEqual(290);
    }
  });

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
    ["ink-muted", "sunken"],
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
