import { describe, expect, it } from "vitest";
import type { PendingShare } from "./hold";
import { previewOf } from "./share-target";

const share = (over: Partial<PendingShare>): PendingShare => ({
  id: "id",
  verified: false,
  title: "",
  text: "",
  url: "",
  files: [],
  ...over,
});

describe("previewOf", () => {
  it("shows a link, text, or the names of the files", () => {
    expect(previewOf(share({ url: "https://example.com/a" }))).toBe(
      "https://example.com/a"
    );
    expect(previewOf(share({ text: "Lemon tart" }))).toBe("Lemon tart");
    expect(
      previewOf(
        share({
          files: [
            { id: "1", file: new File(["x"], "a.png", { type: "image/png" }) },
            {
              id: "2",
              file: new File(["x"], "b.pdf", { type: "application/pdf" }),
            },
          ],
        })
      )
    ).toBe("a.png, b.pdf");
  });
});
