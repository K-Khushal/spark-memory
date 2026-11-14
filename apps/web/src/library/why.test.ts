import { describe, expect, it } from "vitest";
import { clip, colourName, whyLabel } from "./why";

const filter = (field: "colour" | "source" | "kind" | "date", value: string) =>
  whyLabel({
    kind: "image",
    body: null,
    part: { kind: "filter", field, value },
  });

describe("why-chips for filters", () => {
  it("names the Source a result came from", () => {
    expect(filter("source", "www.instagram.com")).toBe("Instagram");
    expect(filter("source", "m.youtube.com")).toBe("YouTube");
    expect(filter("source", "www.nytimes.com")).toBe("nytimes.com");
  });

  it("names the colour found in the image, as people say it", () => {
    expect(filter("colour", "#e8821f")).toBe("Orange");
    expect(filter("colour", "#2f6fe0")).toBe("Blue");
    expect(colourName("#101010")).toBe("Black");
    expect(colourName("#f0f0f2")).toBe("White");
  });

  it("names the kind and the day it was saved", () => {
    expect(filter("kind", "pdf")).toBe("PDF");
    expect(filter("kind", "social_post")).toBe("Link");
    expect(filter("kind", "text")).toBe("Note");
    expect(filter("date", "2026-10-14T09:30:00.000Z")).toMatch(
      /^Saved Oct 1[34]$/
    );
  });
});

describe("why-chips for what a search matched", () => {
  const found = (part: Parameters<typeof whyLabel>[0]["part"], kind = "text") =>
    whyLabel({ kind, body: "the quick brown fox jumps", part } as never);

  it("says which field a word was found in", () => {
    expect(found({ kind: "field", field: "ocr" }, "image")).toBe(
      "Text in Image"
    );
    expect(found({ kind: "field", field: "title" })).toBe("Title");
  });

  it("says where in a PDF, a video and a page of text", () => {
    expect(
      found({ kind: "passage", field: "ocr", start: 0, end: 3, page: 4 }, "pdf")
    ).toBe("Page 4");
    expect(
      found(
        { kind: "passage", field: "body", start: 0, end: 9, seconds: 125 },
        "video"
      )
    ).toBe("Said at 2:05");
    expect(found({ kind: "passage", field: "body", start: 4, end: 9 })).toBe(
      "“quick”"
    );
  });

  it("says when it looks like the query", () => {
    expect(found({ kind: "visual" }, "image")).toBe("Image");
    expect(found({ kind: "overview" })).toBe("Overview");
  });
});

describe("why-chips for text without spaces", () => {
  const passage = (body: string) =>
    whyLabel({
      kind: "text",
      body,
      part: { kind: "passage", field: "body", start: 0, end: body.length },
    });

  it("cuts on whole characters, never through a pair or a joined emoji", () => {
    const family = "👨‍👩‍👧‍👦";
    const body = "あ".repeat(119) + family + "い".repeat(10);
    // A plain slice(0, 120) would end one unit into the emoji.
    expect(body.slice(0, 120).endsWith("\u{1F468}")).toBe(false);
    expect(body.slice(0, 120)).not.toBe(clip(body, 120));
    expect(passage(body)).toBe(`“${"あ".repeat(119)}${family}”`);
    expect(clip("か\u3099".repeat(5), 2)).toBe("か\u3099か\u3099");
  });

  it("leaves short and spaced text as it was", () => {
    expect(passage("検索のテスト")).toBe("“検索のテスト”");
    expect(passage("the  quick\n brown")).toBe("“the quick brown”");
    expect(clip("abc", 3)).toBe("abc");
  });
});
