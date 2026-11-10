import { describe, expect, it } from "vitest";
import { FREE_ALLOWANCE, isFileWithinAllowance, MemoryKind } from "../index";

describe("Free allowance", () => {
  it("accepts a file that fits", () => {
    expect(
      isFileWithinAllowance({ fileBytes: 1024, usedStorageBytes: 0 })
    ).toEqual({ ok: true });
  });

  it("refuses a file over the upload limit", () => {
    expect(
      isFileWithinAllowance({
        fileBytes: FREE_ALLOWANCE.maxUploadBytes + 1,
        usedStorageBytes: 0,
      })
    ).toEqual({ ok: false, reason: "file_too_large" });
  });

  it("refuses a file when storage is full", () => {
    expect(
      isFileWithinAllowance({
        fileBytes: 10,
        usedStorageBytes: FREE_ALLOWANCE.storageBytes,
      })
    ).toEqual({ ok: false, reason: "storage_full" });
  });
});

describe("MemoryKind", () => {
  it("rejects kinds outside the glossary", () => {
    expect(MemoryKind.safeParse("bookmark").success).toBe(false);
  });
});
