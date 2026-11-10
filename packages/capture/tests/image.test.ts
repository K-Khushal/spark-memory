import { describe, expect, it } from "vitest";
import { FREE_ALLOWANCE } from "@spark/core";
import { checkImage, keptType, placeholderUrl } from "../index";

const MB = 1024 * 1024;
const file = (name: string, type: string, bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("keptType", () => {
  it("keeps the image types Spark stores as they are", () => {
    expect(keptType(file("a.png", "image/png"))).toBe("image/png");
    expect(keptType(file("a.avif", "image/avif"))).toBe("image/avif");
  });

  it("keeps HEIC as JPEG, however the browser labels it", () => {
    expect(keptType(file("a.heic", "image/heic"))).toBe("image/jpeg");
    expect(keptType(file("IMG_1.HEIC", ""))).toBe("image/jpeg");
  });

  it("goes by the extension only when the browser gives no type", () => {
    expect(keptType(file("shot.webp", ""))).toBe("image/webp");
    expect(keptType(file("doc.pdf", "application/pdf"))).toBeUndefined();
    expect(keptType(file("vector.svg", "image/svg+xml"))).toBeUndefined();
  });
});

describe("checkImage", () => {
  it("refuses before any work a file over 25 MB or beyond the storage left", () => {
    const big = file("big.png", "image/png", FREE_ALLOWANCE.maxUploadBytes + 1);
    expect(checkImage(big, 0)).toBe("file_too_large");
    const small = file("small.png", "image/png", MB);
    expect(checkImage(small, FREE_ALLOWANCE.storageBytes - MB / 2)).toBe(
      "storage_full"
    );
    expect(checkImage(small, 0)).toBeUndefined();
  });

  it("refuses a file Spark does not keep as an image", () => {
    expect(checkImage(file("notes.txt", "text/plain"), 0)).toBe("unsupported");
  });
});

describe("placeholderUrl", () => {
  it("turns a ThumbHash into a data URL, and a broken one into nothing", () => {
    expect(placeholderUrl("1QcSHQRnh493V4dIh4eXh1h4kJUI")).toMatch(
      /^data:image\/png;base64,/
    );
    expect(placeholderUrl("!!")).toBeUndefined();
  });
});
