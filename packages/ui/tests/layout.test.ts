import { describe, expect, it } from "vitest";
import { columnCount, justifyRows } from "../layout";

describe("columnCount", () => {
  it("fits as many columns of at least the minimum width as it can", () => {
    // 3 × 200 + 2 × 16 = 632 fits in 640; 4 columns would need 848.
    expect(columnCount(640, { minWidth: 200, gap: 16 })).toBe(3);
  });

  it("never returns fewer than one column", () => {
    expect(columnCount(120, { minWidth: 200, gap: 16 })).toBe(1);
    expect(columnCount(0, { minWidth: 200, gap: 16 })).toBe(1);
  });

  it("respects a maximum", () => {
    expect(columnCount(4000, { minWidth: 200, gap: 16, max: 6 })).toBe(6);
  });
});

describe("justifyRows", () => {
  const opts = { width: 1000, targetHeight: 200, gap: 10 };

  it("returns no rows for no items", () => {
    expect(justifyRows([], opts)).toEqual([]);
  });

  it("fills each full row edge to edge", () => {
    const rows = justifyRows([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], opts);
    const first = rows[0]!;
    const used =
      first.items.reduce((sum, item) => sum + item.width, 0) +
      opts.gap * (first.items.length - 1);
    expect(used).toBeCloseTo(opts.width, 6);
    expect(first.height).toBeGreaterThan(150);
    expect(first.height).toBeLessThan(260);
  });

  it("keeps every item's aspect ratio inside a row", () => {
    const aspects = [0.75, 1.78, 1, 1.33, 0.56];
    const rows = justifyRows(aspects, opts);
    const flat = rows.flatMap((row) =>
      row.items.map((item) => item.width / row.height)
    );
    flat.forEach((ratio, i) => expect(ratio).toBeCloseTo(aspects[i]!, 6));
  });

  it("leaves a short last row at the target height instead of stretching it", () => {
    const rows = justifyRows([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1], opts);
    const last = rows.at(-1)!;
    expect(last.height).toBe(opts.targetHeight);
    expect(last.items.map((item) => item.index)).toEqual([6]);
  });

  it("caps an extremely wide item to the row width", () => {
    const [row] = justifyRows([20], opts);
    expect(row!.items[0]!.width).toBeLessThanOrEqual(opts.width);
  });
});
