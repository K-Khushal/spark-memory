import { describe, expect, it, vi } from "vitest";
import type { PendingShare } from "./hold";
import { applyShare, planShare } from "./share";

const file = (name: string, type: string, bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type });

const share = (over: Partial<PendingShare> = {}): PendingShare => ({
  title: "",
  text: "",
  url: "",
  files: [],
  ...over,
});

describe("planShare", () => {
  it("Captures an image file as images", () => {
    const png = file("shot.png", "image/png");
    expect(planShare(share({ files: [png] }))).toEqual({
      images: [png],
      pdfs: [],
      other: [],
    });
  });

  it("treats a JPEG with a .jpg name and empty type as an image", () => {
    const jpg = file("IMG_0001.jpg", "");
    expect(planShare(share({ files: [jpg] })).images).toEqual([jpg]);
  });

  it("refuses a PDF, including one named .pdf with no type", () => {
    const pdf = file("lease.pdf", "application/pdf");
    const named = file("scan.PDF", "");
    expect(planShare(share({ files: [pdf] })).pdfs).toEqual([pdf]);
    expect(planShare(share({ files: [named] })).pdfs).toEqual([named]);
  });

  it("keeps images when a PDF is shared beside them, and ignores text", () => {
    const png = file("shot.png", "image/png");
    const pdf = file("doc.pdf", "application/pdf");
    expect(
      planShare(
        share({
          files: [png, pdf],
          text: "https://example.com",
        })
      )
    ).toEqual({ images: [png], pdfs: [pdf], other: [] });
  });

  it("Captures a URL field as a link", () => {
    expect(
      planShare(share({ url: "https://example.com/a", title: "Example" }))
    ).toEqual({
      images: [],
      pdfs: [],
      other: [],
      link: "https://example.com/a",
    });
  });

  it("Captures text that is exactly one URL, even when the URL field is empty", () => {
    expect(
      planShare(share({ text: "  https://example.com/from-text  " }))
    ).toMatchObject({ link: "https://example.com/from-text" });
  });

  it("takes a trailing URL from Android-style title-plus-link text", () => {
    expect(
      planShare(
        share({
          title: "Example Domain",
          text: "Example Domain https://example.com",
        })
      )
    ).toMatchObject({ link: "https://example.com" });
  });

  it("Captures leftover text, using the title when that is all there is", () => {
    expect(planShare(share({ text: "Cardamom buns" }))).toMatchObject({
      text: "Cardamom buns",
    });
    expect(planShare(share({ title: "A title" }))).toMatchObject({
      text: "A title",
    });
    expect(planShare(share({ title: "Note", text: "The body" }))).toMatchObject(
      { text: "Note\nThe body" }
    );
  });

  it("does not treat mixed prose and a URL as a link", () => {
    expect(
      planShare(share({ text: "read this https://example.com" }))
    ).toMatchObject({
      text: "read this https://example.com",
    });
  });
});

describe("applyShare", () => {
  it("sends images, refuses PDFs, and does not Capture leftover text", async () => {
    const png = file("shot.png", "image/png");
    const pdf = file("doc.pdf", "application/pdf");
    const capture = vi.fn();
    const captureImages = vi.fn(async () => {});
    const notify = vi.fn();
    await applyShare(
      planShare(share({ files: [png, pdf], text: "hello" })),
      { capture, captureImages },
      notify
    );
    expect(captureImages).toHaveBeenCalledWith([png]);
    expect(capture).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("PDFs Can't Be Captured Yet");
  });

  it("Captures a link, or text when there is no link", async () => {
    const capture = vi.fn(() => true);
    const captureImages = vi.fn(async () => {});
    await applyShare(
      planShare(share({ url: "https://example.com" })),
      { capture, captureImages },
      vi.fn()
    );
    expect(capture).toHaveBeenCalledWith("https://example.com");
    capture.mockClear();
    await applyShare(
      planShare(share({ text: "Lemon tart" })),
      { capture, captureImages },
      vi.fn()
    );
    expect(capture).toHaveBeenCalledWith("Lemon tart");
  });

  it("names a file Spark cannot Capture", async () => {
    const notify = vi.fn();
    await applyShare(
      planShare(share({ files: [file("clip.mp4", "video/mp4")] })),
      { capture: vi.fn(), captureImages: vi.fn(async () => {}) },
      notify
    );
    expect(notify).toHaveBeenCalledWith("This Can't Be Captured");
  });
});
