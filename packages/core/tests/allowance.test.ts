import { describe, expect, it } from "vitest";
import {
  DEEP_FETCH,
  FREE_ALLOWANCE,
  allowanceUsage,
  formatSize,
  isCaptureWithinAllowance,
  isFileWithinAllowance,
} from "@spark/core";

const MB = 1024 * 1024;

describe("the Free allowance config", () => {
  it("holds the numbers docs/PLAN.md names", () => {
    expect(FREE_ALLOWANCE).toMatchObject({
      storageBytes: 1024 * MB,
      maxUploadBytes: 25 * MB,
      capturesPerDay: 100,
      pdfPagesIndexed: 30,
      videoTranscriptMaxMinutes: 60,
      deepFetchesPerDay: 20,
    });
  });

  it("is the only source of the Deep fetch daily limit", () => {
    expect(DEEP_FETCH.perDay).toBe(FREE_ALLOWANCE.deepFetchesPerDay);
  });
});

describe("a file against the allowance", () => {
  const room = (fileBytes: number, usedStorageBytes = 0) =>
    isFileWithinAllowance({ fileBytes, usedStorageBytes });

  it("takes a file of exactly the upload limit and refuses one byte more", () => {
    expect(room(FREE_ALLOWANCE.maxUploadBytes)).toEqual({ ok: true });
    expect(room(FREE_ALLOWANCE.maxUploadBytes + 1)).toEqual({
      ok: false,
      reason: "file_too_large",
    });
  });

  it("takes a file that fills storage exactly and refuses one byte more", () => {
    const used = FREE_ALLOWANCE.storageBytes - MB;
    expect(room(MB, used)).toEqual({ ok: true });
    expect(room(MB + 1, used)).toEqual({ ok: false, reason: "storage_full" });
  });
});

describe("Captures in a day", () => {
  it("takes the last one the allowance gives and refuses the next", () => {
    expect(isCaptureWithinAllowance(FREE_ALLOWANCE.capturesPerDay - 1)).toBe(
      true
    );
    expect(isCaptureWithinAllowance(FREE_ALLOWANCE.capturesPerDay)).toBe(false);
    expect(isCaptureWithinAllowance(FREE_ALLOWANCE.capturesPerDay + 5)).toBe(
      false
    );
  });
});

describe("usage for Settings", () => {
  it("pairs each count with its limit and says when the day resets", () => {
    const now = new Date("2026-11-13T22:30:00Z");
    expect(
      allowanceUsage({ storageBytes: 5, captures: 7, deepFetches: 2 }, now)
    ).toEqual({
      storage: { used: 5, limit: FREE_ALLOWANCE.storageBytes },
      captures: { used: 7, limit: FREE_ALLOWANCE.capturesPerDay },
      deepFetches: { used: 2, limit: FREE_ALLOWANCE.deepFetchesPerDay },
      resetsAt: "2026-11-14T00:00:00.000Z",
    });
  });
});

describe("sizes in words", () => {
  it("writes the limits the way the copy does", () => {
    expect(formatSize(FREE_ALLOWANCE.maxUploadBytes)).toBe("25 MB");
    expect(formatSize(FREE_ALLOWANCE.storageBytes)).toBe("1 GB");
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1536 * 1024)).toBe("1.5 MB");
  });
});
