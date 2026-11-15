import { describe, expect, it } from "vitest";
import { pageWithWords, pdfMatch } from "./pdf-match";

const body = "Intro page\fThe heron nests by the weir\fIndex";

describe("where a PDF opens", () => {
  it("at a Passage's page, with its words", () => {
    expect(
      pdfMatch(
        {
          body,
          part: { kind: "passage", field: "body", start: 11, end: 26, page: 2 },
        },
        ""
      )
    ).toEqual({ page: 2, passage: "The heron nests" });
  });

  it("at a scan's page, with no words to mark", () => {
    expect(
      pdfMatch(
        {
          body: null,
          part: { kind: "passage", field: "ocr", start: 0, end: 9, page: 3 },
        },
        ""
      )
    ).toEqual({ page: 3 });
  });

  it("never marks a scan's recognised words, even with Indexed text beside them", () => {
    expect(
      pdfMatch(
        {
          body,
          part: { kind: "passage", field: "ocr", start: 11, end: 26, page: 2 },
        },
        ""
      )
    ).toEqual({ page: 2 });
  });

  it("at the page whose image matched", () => {
    expect(pdfMatch({ body, part: { kind: "visual", page: 4 } }, "")).toEqual({
      page: 4,
    });
  });

  it("at the page search found a word on", () => {
    expect(
      pdfMatch(
        { body: null, part: { kind: "field", field: "text", page: 3 } },
        ""
      )
    ).toEqual({ page: 3 });
  });

  it("at the first page holding a typed word", () => {
    expect(
      pdfMatch({ body, part: { kind: "field", field: "text" } }, "WEIR heron")
    ).toEqual({ page: 2 });
    expect(pageWithWords(body, "nothing")).toBeUndefined();
    expect(pageWithWords("one page only", "page")).toBeUndefined();
  });

  it("at the first page holding a typed word when what matched names no page", () => {
    expect(pdfMatch({ body, part: { kind: "overview" } }, "heron")).toEqual({
      page: 2,
    });
  });

  it("at the top otherwise", () => {
    expect(pdfMatch({ body, part: { kind: "overview" } }, "x")).toEqual({});
    expect(pdfMatch({ body, part: null }, "x")).toEqual({});
  });
});
