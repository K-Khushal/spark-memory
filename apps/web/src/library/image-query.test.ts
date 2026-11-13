import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchByImage } from "./image-query";
import type { Memory } from "./use-library";

const memory = (over: Partial<Memory> = {}): Memory => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "image",
  title: "Visual Reference",
  body: null,
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  indexError: null,
  indexTitle: null,
  sample: false,
  aiOptOut: false,
  hasVectors: true,
  deepFetch: null,
  categories: ["Other"],
  categoriesLocked: false,
  revision: 1,
  capturedAt: "2026-11-13T00:00:00.000Z",
  lastSavedAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z",
  sourceUrl: null,
  pageTitle: null,
  description: null,
  pages: null,
  image: null,
  ...over,
});
const action = (over: Partial<Memory>) =>
  renderToStaticMarkup(
    createElement(SearchByImage, { memory: memory(over), onSelect: () => {} })
  );

describe("Search By Image on a Memory", () => {
  it.each(["text", "link", "social_post", "file"] as const)(
    "does not offer image search for a %s with only text vectors",
    (kind) => expect(action({ kind })).toBe("")
  );
  it.each(["image", "pdf", "video"] as const)(
    "offers image search for an indexed %s",
    (kind) => expect(action({ kind })).toContain("Search By Image")
  );
  it("offers image search for an indexed reel", () => {
    expect(
      action({
        kind: "video",
        sourceUrl: "https://www.instagram.com/reel/abc123/",
      })
    ).toContain("Search By Image");
  });
  it("does not offer it before embedding or after AI opt-out", () => {
    expect(action({ hasVectors: false })).toBe("");
    expect(action({ aiOptOut: true })).toBe("");
  });
});
