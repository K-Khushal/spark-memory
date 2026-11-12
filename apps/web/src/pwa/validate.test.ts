import { describe, expect, it } from "vitest";
import { FREE_ALLOWANCE } from "@spark/core";
import type { PendingShare } from "./hold";
import { checkShare, MAX_SHARE_FILES } from "./validate";

const file = (name: string, type: string, bytes = 8) => ({
  id: crypto.randomUUID(),
  file: new File([new Uint8Array(bytes)], name, { type }),
});

const share = (over: Partial<PendingShare> = {}): PendingShare => ({
  id: crypto.randomUUID(),
  verified: true,
  title: "",
  text: "",
  url: "",
  files: [],
  ...over,
});

describe("checkShare", () => {
  it("accepts text, a link, images, a PDF and HEIC", () => {
    expect(checkShare(share({ text: "Lemon tart" }))).toBeUndefined();
    expect(checkShare(share({ url: "https://example.com" }))).toBeUndefined();
    expect(
      checkShare(
        share({
          files: [
            file("a.png", "image/png"),
            file("b.heic", "image/heic"),
            file("c.pdf", "application/pdf"),
            file("IMG_1.jpg", ""),
          ],
        })
      )
    ).toBeUndefined();
  });

  it("refuses text past the allowance, counting title, text and url", () => {
    const half = "a".repeat(FREE_ALLOWANCE.textMaxChars / 2 + 1);
    expect(checkShare(share({ text: half, title: half }))).toBe("too_long");
    expect(
      checkShare(share({ text: "a".repeat(FREE_ALLOWANCE.textMaxChars) }))
    ).toBeUndefined();
  });

  it("refuses a file over the upload limit", () => {
    const big = file("big.png", "image/png", FREE_ALLOWANCE.maxUploadBytes + 1);
    expect(checkShare(share({ files: [big] }))).toBe("too_large");
  });

  it("refuses more files than the cap", () => {
    const files = Array.from({ length: MAX_SHARE_FILES + 1 }, () =>
      file("a.png", "image/png")
    );
    expect(checkShare(share({ files }))).toBe("too_many");
  });

  it("refuses a file type Spark cannot Capture, even beside an image", () => {
    expect(
      checkShare(
        share({
          files: [file("a.png", "image/png"), file("clip.mp4", "video/mp4")],
        })
      )
    ).toBe("unsupported");
  });

  it("refuses a share with nothing in it", () => {
    expect(checkShare(share())).toBe("empty");
  });
});
