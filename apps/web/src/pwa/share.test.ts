import { describe, expect, it, vi } from "vitest";
import type { HeldFile, PendingShare } from "./hold";
import { applyShare, planShare, type ShareLibrary } from "./share";

const held = (name: string, type: string): HeldFile => ({
  id: crypto.randomUUID(),
  file: new File([new Uint8Array(8)], name, { type }),
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

describe("planShare", () => {
  it("Captures an image file as an image, keeping its id", () => {
    const png = held("shot.png", "image/png");
    const input = share({ files: [png] });
    expect(planShare(input)).toEqual({
      id: input.id,
      images: [png],
      pdfs: [],
    });
  });

  it("treats a JPEG with a .jpg name and empty type as an image", () => {
    const jpg = held("IMG_0001.jpg", "");
    expect(planShare(share({ files: [jpg] })).images).toEqual([jpg]);
  });

  it("sorts a PDF, including one named .pdf with no type", () => {
    const pdf = held("lease.pdf", "application/pdf");
    const named = held("scan.PDF", "");
    expect(planShare(share({ files: [pdf] })).pdfs).toEqual([pdf]);
    expect(planShare(share({ files: [named] })).pdfs).toEqual([named]);
  });

  it("keeps images when a PDF is shared beside them, and ignores text", () => {
    const png = held("shot.png", "image/png");
    const pdf = held("doc.pdf", "application/pdf");
    const plan = planShare(
      share({ files: [png, pdf], text: "https://example.com" })
    );
    expect(plan.images).toEqual([png]);
    expect(plan.pdfs).toEqual([pdf]);
    expect(plan.link).toBeUndefined();
  });

  it("Captures a URL field as a link", () => {
    expect(
      planShare(share({ url: "https://example.com/a", title: "Example" }))
    ).toMatchObject({ link: "https://example.com/a" });
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
    ).toMatchObject({ text: "read this https://example.com" });
  });
});

describe("applyShare", () => {
  const library = () => {
    const captureShared = vi.fn(async () => "stored" as const);
    const captureSharedImages = vi.fn(async (files: HeldFile[]) =>
      files.map(() => "stored" as const)
    );
    return { captureShared, captureSharedImages } satisfies ShareLibrary;
  };

  it("sends images with their ids, refuses PDFs, and leaves text alone", async () => {
    const png = held("shot.png", "image/png");
    const pdf = held("doc.pdf", "application/pdf");
    const lib = library();
    const notify = vi.fn();
    await applyShare(
      planShare(share({ files: [png, pdf], text: "hello" })),
      lib,
      notify
    );
    expect(lib.captureSharedImages).toHaveBeenCalledWith([png]);
    expect(lib.captureShared).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("PDFs Can't Be Captured Yet");
  });

  it("Captures a link, or text when there is no link, under the share's id", async () => {
    const lib = library();
    const link = share({ url: "https://example.com" });
    await applyShare(planShare(link), lib, vi.fn());
    expect(lib.captureShared).toHaveBeenCalledWith(
      "https://example.com",
      link.id
    );
    const text = share({ text: "Lemon tart" });
    await applyShare(planShare(text), lib, vi.fn());
    expect(lib.captureShared).toHaveBeenCalledWith("Lemon tart", text.id);
  });

  it("is not done until the server has the Capture", async () => {
    let finish: (outcome: "stored") => void = () => {};
    const lib = {
      ...library(),
      captureShared: vi.fn(
        () => new Promise<"stored">((resolve) => (finish = resolve))
      ),
    };
    let done = false;
    const applied = applyShare(
      planShare(share({ text: "hello" })),
      lib,
      vi.fn()
    ).then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    finish("stored");
    await applied;
    expect(done).toBe(true);
  });
});
