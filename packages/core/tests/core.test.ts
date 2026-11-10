import { describe, expect, it } from "vitest";
import {
  FREE_ALLOWANCE,
  ImageCapture,
  isFileWithinAllowance,
  MemoryKind,
  TextCapture,
} from "../index";

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

describe("TextCapture", () => {
  it("trims the text and turns an empty Capture note into none", () => {
    expect(TextCapture.parse({ body: "  pasted  ", captureNote: " " })).toEqual(
      { body: "pasted", captureNote: null }
    );
  });

  it("refuses empty text and text over the Free allowance", () => {
    expect(TextCapture.safeParse({ body: "   " }).success).toBe(false);
    const body = "a".repeat(FREE_ALLOWANCE.textMaxChars + 1);
    expect(TextCapture.safeParse({ body }).success).toBe(false);
  });
});

describe("ImageCapture", () => {
  const valid = {
    id: "0b8e5a52-7d3c-4f4e-9a59-2f8f6d0c1e11",
    mime: "image/png",
    bytes: 1024,
    width: 800,
    height: 600,
    contentHash: "a".repeat(64),
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    thumbnail: { mime: "image/webp", bytes: 200 },
  };
  const parses = (over: object) =>
    ImageCapture.safeParse({ ...valid, ...over }).success;

  it("accepts an image the browser described", () => {
    expect(parses({})).toBe(true);
  });

  it("refuses HEIC, which the browser converts", () => {
    expect(parses({ mime: "image/heic" })).toBe(false);
  });

  it("refuses a content hash that is not SHA-256 hex", () => {
    expect(parses({ contentHash: "not-a-hash" })).toBe(false);
  });
});
