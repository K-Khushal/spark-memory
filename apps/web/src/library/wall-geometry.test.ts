/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnCount } from "@spark/ui/layout";
import { wallColumns } from "./wall-geometry";

const phoneWidth = (screen: number) => screen - 24; // 12px of wall padding a side

afterEach(() => {
  document.documentElement.style.fontSize = "";
  vi.unstubAllGlobals();
});

describe("the wall's lanes", () => {
  it("is two lanes on a phone, 179px at 390 and 144px at 320", () => {
    const phone = wallColumns(true);
    expect(columnCount(phoneWidth(390), phone)).toBe(2);
    expect(columnCount(phoneWidth(320), phone)).toBe(2);
    expect((phoneWidth(390) - phone.gap) / 2).toBe(179);
    expect((phoneWidth(320) - phone.gap) / 2).toBe(144);
  });

  it("is one lane when the browser's text is doubled", async () => {
    document.documentElement.style.fontSize = "32px";
    // The root size is read once a frame.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(columnCount(phoneWidth(390), wallColumns(true))).toBe(1);
  });

  it("keeps 220px columns and 12px gaps on a desktop", () => {
    expect(wallColumns(false)).toEqual({ minWidth: 220, gap: 12, max: 6 });
  });
});
