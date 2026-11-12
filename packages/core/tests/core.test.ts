import { describe, expect, it } from "vitest";
import {
  FREE_ALLOWANCE,
  ImageCapture,
  isFileWithinAllowance,
  MemoryKind,
  SearchChips,
  SearchEvent,
  SearchRequest,
  sourceHosts,
  sourceOf,
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

describe("search filters", () => {
  it("files a URL under its Source", () => {
    expect(sourceOf("https://www.instagram.com/p/x")).toBe("instagram");
    expect(sourceOf("https://m.youtube.com/watch?v=1")).toBe("youtube");
    expect(sourceOf("https://youtu.be/abc")).toBe("youtube");
    expect(sourceOf("https://x.com/a/status/1")).toBe("twitter");
    expect(sourceOf("https://www.nytimes.com/2026/a")).toBe("nytimes.com");
    expect(sourceOf("https://instagram.com.evil.test/p")).toBe(
      "instagram.com.evil.test"
    );
    expect(sourceOf("not a url")).toBeUndefined();
    expect(sourceOf("http://localhost/x")).toBeUndefined();
  });

  it("expands a Source name to its hosts, and leaves a domain alone", () => {
    expect(sourceHosts("youtube")).toEqual(["youtube.com", "youtu.be"]);
    expect(sourceHosts("nytimes.com")).toEqual(["nytimes.com"]);
  });

  it("accepts one chip per group and nothing it does not know", () => {
    expect(
      SearchChips.safeParse({
        kind: "link",
        when: "last month",
        colour: "teal",
      }).success
    ).toBe(true);
    for (const bad of [
      { kind: "file" },
      { colour: "#fff" },
      { when: "tomorrow" },
      { source: "a b" },
      { category: "recipe" },
    ])
      expect(SearchChips.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false
      );
  });

  it("takes a click only with its position", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(SearchEvent.safeParse({ query: "x" }).success).toBe(true);
    expect(
      SearchEvent.safeParse({ query: "x", memoryId: id, position: 3 }).success
    ).toBe(true);
    expect(SearchEvent.safeParse({ query: "x", memoryId: id }).success).toBe(
      false
    );
    expect(SearchEvent.safeParse({ query: "x", position: 3 }).success).toBe(
      false
    );
    expect(
      SearchEvent.safeParse({ query: "x", memoryId: id, position: 0 }).success
    ).toBe(false);
  });

  it("reads a search body: words, chips, a page, and nothing else", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(SearchRequest.parse({})).toEqual({ q: "", mode: "instant" });
    expect(
      SearchRequest.parse({
        q: "x".repeat(900),
        mode: "full",
        timezone: "Asia/Kolkata",
        chips: { kind: "image", colour: "blue" },
        page: `c:${id}`,
      })
    ).toMatchObject({ q: "x".repeat(300), mode: "full", page: `c:${id}` });
    expect(SearchRequest.parse({ page: "o:40" }).page).toBe("o:40");
    for (const bad of [
      { page: "o:0" },
      { page: "o:-1" },
      { page: "o:999999" },
      { page: "c:not-an-id" },
      { page: "40" },
      { mode: "deep" },
      { chips: { kind: "file" } },
      { q: "x".repeat(2001) },
      { offset: 5 },
    ])
      expect(SearchRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false
      );
  });
});
