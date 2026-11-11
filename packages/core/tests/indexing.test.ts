import { describe, expect, it } from "vitest";
import { ImageCapture, INDEXING, IndexingOutput, Palette } from "../index";

const valid = {
  title: "Lemon tart",
  description: "A recipe for a lemon tart.",
  ocrText: "",
  entities: ["Mary Berry"],
  tags: ["recipe", "dessert"],
  language: "en",
};

describe("Indexing output", () => {
  it("accepts a complete answer", () => {
    expect(IndexingOutput.parse(valid)).toEqual(valid);
  });

  it("cuts long fields and duplicate words instead of refusing them", () => {
    const out = IndexingOutput.parse({
      ...valid,
      title: "x".repeat(400),
      tags: [" a ", "a", "", ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
    });
    expect(out.title).toHaveLength(300);
    expect(out.tags[0]).toBe("a");
    expect(out.tags).toHaveLength(12);
  });

  it("canonicalises the language and refuses what is not BCP-47", () => {
    expect(IndexingOutput.parse({ ...valid, language: "pt-br" }).language).toBe(
      "pt-BR"
    );
    expect(
      IndexingOutput.safeParse({ ...valid, language: "English" }).success
    ).toBe(false);
  });

  it("refuses a missing field", () => {
    const { tags: _, ...partial } = valid;
    expect(IndexingOutput.safeParse(partial).success).toBe(false);
  });

  it("prices every model in the chain", () => {
    for (const model of Object.values(INDEXING.models)) {
      expect(INDEXING.pricesMicrosPerMTokens[model]).toBeDefined();
    }
  });
});

describe("Palette", () => {
  it("is optional on an image Capture and holds hex colours only", () => {
    const capture = {
      id: "6f1d1a5e-1d2b-4c3a-9a7e-1f2e3d4c5b6a",
      mime: "image/png",
      bytes: 10,
      width: 1,
      height: 1,
      contentHash: "ab".repeat(32),
      thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
      thumbnail: { mime: "image/webp", bytes: 5 },
    };
    expect(ImageCapture.parse(capture).palette).toBeUndefined();
    expect(Palette.safeParse(["#ff8800"]).success).toBe(true);
    expect(Palette.safeParse(["red"]).success).toBe(false);
  });
});
