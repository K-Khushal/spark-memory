import { describe, expect, it } from "vitest";
import { colourName, whyLabel } from "./why";

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
