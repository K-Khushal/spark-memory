import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "@spark/ui/tokens";

const manifest = JSON.parse(
  readFileSync(
    new URL("../../public/manifest.webmanifest", import.meta.url),
    "utf8"
  )
) as {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
  share_target: {
    action: string;
    method: string;
    enctype: string;
    params: {
      title: string;
      text: string;
      url: string;
      files: { name: string; accept: string[] }[];
    };
  };
};

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const offline = readFileSync(
  new URL("../../public/offline.html", import.meta.url),
  "utf8"
);

describe("web app manifest", () => {
  it("installs as Spark, standalone, with the canvas tokens", () => {
    expect(manifest.name).toBe("Spark");
    expect(manifest.short_name).toBe("Spark");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color.toLowerCase()).toBe(
      THEMES.light.canvas.toLowerCase()
    );
    expect(manifest.theme_color.toLowerCase()).toBe(
      THEMES.light.canvas.toLowerCase()
    );
  });

  it("has 192 and 512 icons, any and maskable", () => {
    const keys = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "192x192:any",
        "512x512:any",
        "192x192:maskable",
        "512x512:maskable",
      ])
    );
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src).toMatch(/^\/icons\//);
    }
  });

  it("declares a multipart POST share target for text, URLs and files", () => {
    const target = manifest.share_target;
    expect(target.action).toBe("/share");
    expect(target.method).toBe("POST");
    expect(target.enctype).toBe("multipart/form-data");
    expect(target.params).toMatchObject({
      title: "title",
      text: "text",
      url: "url",
    });
    expect(target.params.files[0]?.name).toBe("files");
    expect(target.params.files[0]?.accept).toEqual(
      expect.arrayContaining(["image/*", "application/pdf"])
    );
  });

  it("is linked from index.html with viewport-fit for safe areas", () => {
    expect(html).toMatch(/rel="manifest"\s+href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/apple-touch-icon/);
  });
});

describe("offline page", () => {
  it("is a whole-screen Spark title on the canvas tokens, with Try Again", () => {
    expect(offline).toMatch(/Spark Is Offline/);
    expect(offline).toMatch(/Try Again/);
    expect(offline.toLowerCase()).toContain(THEMES.light.canvas.toLowerCase());
    expect(offline.toLowerCase()).toContain(THEMES.light.ink.toLowerCase());
    expect(offline.toLowerCase()).toContain(THEMES.dark.canvas.toLowerCase());
    expect(offline).toMatch(/min-height:\s*100dvh/);
    expect(offline).not.toMatch(/100vh/);
  });
});
