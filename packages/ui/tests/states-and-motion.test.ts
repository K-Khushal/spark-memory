import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DURATION, TOUCH_TARGET } from "../tokens";
import { toastOffset } from "../index";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const libDir = new URL("../lib/", import.meta.url);
/** Code without its comments, which may name what the code avoids. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sources = readdirSync(fileURLToPath(libDir))
  .filter((file) => /\.tsx?$/.test(file))
  .map(
    (file) => [file, code(readFileSync(new URL(file, libDir), "utf8"))] as const
  );

describe("shared geometry", () => {
  it("a coarse pointer's target is 44px, as --size-touch", () => {
    expect(TOUCH_TARGET).toBe(44);
    expect(css).toContain(`--size-touch: ${TOUCH_TARGET / 16}rem;`);
  });

  it("the preview fade is 150ms", () => {
    expect(DURATION.preview).toBe(150);
  });
});

describe("overlay motion (DESIGN.md → Motion)", () => {
  it("never uses ease-in, transition-all or animate-all anywhere in the package", () => {
    for (const [file, source] of sources) {
      expect(source, file).not.toMatch(
        /transition-all|animate-all|ease-in(?!-out)\b/
      );
    }
    expect(code(css)).not.toMatch(/ease-in(?!-out)\b|transition: all/);
  });

  it("every animation in styles.css names a duration and easing token", () => {
    const lines = css.split("\n").filter((l) => /^\s*animation:/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines.filter((l) => !l.includes("none"))) {
      expect(line, line).toMatch(/var\(--duration-[a-z]+\)/);
      expect(line, line).toMatch(/var\(--ease-[a-z-]+\)/);
    }
  });

  it("a pointer-opened dialog scales from .98 in the small duration", () => {
    expect(css).toMatch(
      /@keyframes spark-dialog-in \{[^}]*\{[^}]*scale: 0\.98/
    );
    expect(css).toMatch(
      /\[data-state="open"\] \{\s*animation: spark-dialog-in var\(--duration-small\)/
    );
  });

  it("a keyboard-opened dialog and a full-screen viewer only fade", () => {
    expect(css).toMatch(
      /html\[data-input="keyboard"\] \[data-slot="dialog-content"\]\[data-state="open"\],\s*\[data-slot="dialog-content"\]\[data-presentation="fullscreen"\]\[data-state="open"\] \{\s*animation: spark-fade-in var\(--duration-preview\)/
    );
  });

  it("a phone sheet rises on the panel duration with the drawer curve, and fades under reduced motion", () => {
    expect(css).toMatch(
      /spark-sheet-in var\(--duration-panel\) var\(--ease-drawer\)/
    );
    expect(css).toMatch(
      /max-width: 639\.98px\) and \(prefers-reduced-motion: reduce\)[\s\S]*spark-fade-in/
    );
  });

  it("the ⌘K menu is not given any entrance", () => {
    const command = readFileSync(new URL("command.tsx", libDir), "utf8");
    expect(command).not.toMatch(/animate-|data-slot="dialog/);
  });

  it("the skeleton is static: no shimmer, pulse or loop", () => {
    const skeleton = readFileSync(new URL("skeleton.tsx", libDir), "utf8");
    expect(skeleton).not.toMatch(/animate-|animation/);
    expect(css).not.toMatch(/skeleton[^}]*infinite/);
  });
});

describe("toastOffset", () => {
  it("sits at the safe bottom edge when nothing is pinned there", () => {
    expect(toastOffset(0)).toBe("max(1rem, env(safe-area-inset-bottom))");
  });

  it("stacks above a registered bar with a 12px gap", () => {
    expect(toastOffset(56)).toBe(
      "calc(max(1rem, env(safe-area-inset-bottom)) + 56px + 12px)"
    );
  });
});

describe("controls", () => {
  const button = readFileSync(new URL("button.tsx", libDir), "utf8");

  it("every Button size grows to the touch target on a coarse pointer", () => {
    const sizes = /size: \{([^}]+)\}/.exec(button)?.[1] ?? "";
    const lines = sizes.split("\n").filter((l) => l.includes(': "'));
    expect(lines.length).toBe(4);
    for (const line of lines) expect(line).toContain("pointer-coarse:");
  });

  it("wrap is an explicit variant, not a descendant rule", () => {
    expect(button).toMatch(/wrap: \{\s*true: "h-auto/);
  });
});
