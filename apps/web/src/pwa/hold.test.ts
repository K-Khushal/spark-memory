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
    const pending = shareFromForm(form);
    expect(pending.title).toBe("Example");
    expect(pending.text).toBe("https://example.com");
    expect(pending.url).toBe("");
    expect(pending.files).toHaveLength(1);
    expect(pending.files[0]?.name).toBe("shot.png");
  });
});
