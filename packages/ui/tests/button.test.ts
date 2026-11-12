import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../lib/button.tsx", import.meta.url),
  "utf8"
);

describe("outline button", () => {
  it("uses line-strong as its border", () => {
    const outline = /outline:\s*\n\s*"([^"]+)"/.exec(source)?.[1];
    expect(outline).toContain("border-line-strong");
  });
});
