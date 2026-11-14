import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryEditor } from "./categories";
import type { Memory } from "./use-library";

vi.mock("../api", () => ({ api: {} }));

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
  categoriesVersion: null,
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
const summary = (over: Partial<Memory>, compact = false) =>
  renderToStaticMarkup(
    createElement(CategoryEditor, {
      memory: memory(over),
      onSave: async () => true,
      compact,
    })
  ).match(/<summary[\s\S]*?<\/summary>/)?.[0];

describe("Category pending state", () => {
  it("shows a quiet pending label instead of Other before automatic assignment", () => {
    expect(summary({})).toContain("Categorising");
    expect(summary({})).toContain("text-ink-muted");
    expect(summary({})).not.toContain("Other");
  });
  it("shows a real Other after assignment or a person's deliberate choice", () => {
    expect(summary({ categoriesVersion: 1 })).toContain("Other");
    expect(summary({ categoriesLocked: true })).toContain("Other");
    expect(summary({ categoriesVersion: 1 })).not.toContain("Categorising");
  });
  it("keeps viewer controls compact while naming pending and assigned Categories", () => {
    expect(summary({}, true)).toContain(
      'aria-label="Categories: Categorising"'
    );
    expect(summary({}, true)).toContain('class="sr-only"');
    expect(summary({}, true)).toContain("lucide-clock");
    expect(summary({}, true)).not.toContain("lucide-chevron-down");
    expect(summary({ categoriesVersion: 1 }, true)).toContain("lucide-tags");
  });
  it("keeps long and non-Latin Category names in the accessible summary", () => {
    const names = ["Design References For The Next Apartment", "旅行", "A"];
    const markup = summary({ categories: names, categoriesLocked: true });
    expect(markup).toContain(`aria-label="Categories: ${names.join(", ")}"`);
    expect(markup).toContain("wrap-anywhere");
  });
});
