import { describe, expect, it } from "vitest";
import { shareFromForm } from "./hold";

const file = (name: string, type: string, bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("shareFromForm", () => {
  it("reads title, text, url and named files, skipping empty ones", () => {
    const form = new FormData();
    form.set("title", "Example");
    form.set("text", "https://example.com");
    form.set("url", "");
    form.append("files", file("shot.png", "image/png"));
    form.append("files", file("empty.png", "image/png", 0));
    const pending = shareFromForm(form, true);
    expect(pending.title).toBe("Example");
    expect(pending.text).toBe("https://example.com");
    expect(pending.url).toBe("");
    expect(pending.files).toHaveLength(1);
    expect(pending.files[0]?.file.name).toBe("shot.png");
  });

  it("gives the share and each file its own Capture id, once", () => {
    const form = new FormData();
    form.set("text", "hello");
    form.append("files", file("a.png", "image/png"));
    form.append("files", file("b.png", "image/png"));
    const pending = shareFromForm(form, true);
    const ids = [pending.id, ...pending.files.map((f) => f.id)];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("marks whether the post is sure to be a share", () => {
    expect(shareFromForm(new FormData(), true).verified).toBe(true);
    expect(shareFromForm(new FormData(), false).verified).toBe(false);
  });
});
