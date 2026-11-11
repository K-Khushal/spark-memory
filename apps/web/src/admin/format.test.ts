import { describe, expect, it } from "vitest";
import {
  dollarsToMicros,
  formatBytes,
  formatCost,
  microsToDollars,
} from "./format";

describe("admin amounts", () => {
  it("turns the daily budget between dollars and micro-dollars", () => {
    expect(microsToDollars(0)).toBe("0");
    expect(microsToDollars(1_000_000)).toBe("1");
    expect(microsToDollars(1_500_000)).toBe("1.5");
    expect(microsToDollars(1_234_000)).toBe("1.234");
    expect(dollarsToMicros("1")).toBe(1_000_000);
    expect(dollarsToMicros("1.5")).toBe(1_500_000);
    expect(dollarsToMicros("0")).toBe(0);
    expect(dollarsToMicros("1.234567")).toBe(1_234_567);
    expect(dollarsToMicros("1.2345678")).toBeUndefined();
    expect(dollarsToMicros("-1")).toBeUndefined();
    expect(dollarsToMicros("")).toBeUndefined();
  });

  it("shows cost and storage", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1_000_000)).toBe("$1.00");
    expect(formatCost(1_500_000)).toBe("$1.50");
    expect(formatCost(1_234)).toBe("$0.0012");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});
