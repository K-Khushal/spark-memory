// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { parseImport } from "../import";
import fixture0 from "./fixtures/import/chrome.html?raw";
import fixture1 from "./fixtures/import/firefox.html?raw";
import fixture2 from "./fixtures/import/safari.html?raw";
import fixture3 from "./fixtures/import/pocket.html?raw";
import fixture4 from "./fixtures/import/pocket.csv?raw";
import fixture5 from "./fixtures/import/raindrop.html?raw";
import fixture6 from "./fixtures/import/raindrop.csv?raw";
import fixture7 from "./fixtures/import/urls.txt?raw";

it("reads browser folders, tags, entities and saved dates without executable markup", () => {
  const result = parseImport(
    `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Recipes</H3><DL><p><DT><A HREF="https://food.test/?utm_source=x" ADD_DATE="1609459200" TAGS="food,home">Tea &amp; Toast</A><DT><A HREF="javascript:alert(1)">Bad</A></DL></DL>`
  );
  expect(result).toEqual({
    items: [
      {
        url: "https://food.test/?utm_source=x",
        title: "Tea & Toast",
        captureNote: "Recipes · food,home",
        savedAt: "2021-01-01T00:00:00.000Z",
      },
    ],
    skipped: 1,
  });
});

it("retains browser export folder ancestry and Pocket and Raindrop metadata", async () => {
  const fixtures = {
    "chrome.html": fixture0,
    "firefox.html": fixture1,
    "safari.html": fixture2,
    "pocket.html": fixture3,
    "pocket.csv": fixture4,
    "raindrop.html": fixture5,
    "raindrop.csv": fixture6,
    "urls.txt": fixture7,
  };
  for (const [path, text] of Object.entries(fixtures)) {
    const parsed = parseImport(text);
    expect(parsed.items[0]?.url, path).toBe("https://garden.test/tea");
    if (path.includes("chrome"))
      expect(parsed.items[0]?.captureNote).toBe("Bookmarks bar · Recipes");
    if (path.endsWith("pocket.csv"))
      expect(parsed.items[0]?.title).toBe('Tea, "Toast"');
    if (path.endsWith("raindrop.csv"))
      expect(parsed.items[0]?.captureNote).toContain("Morning\nreading");
    if (!path.includes("safari") && !path.includes("urls"))
      expect(parsed.items[0]?.savedAt).toBe("2021-01-01T00:00:00.000Z");
  }
});
it("rejects oversized exports, excess URLs and incomplete CSV", () => {
  expect(() => parseImport("x".repeat(10 * 1024 * 1024 + 1))).toThrow(
    "File Exceeds"
  );
  expect(() => parseImport("https://garden.test/tea\n".repeat(10001))).toThrow(
    "Export Exceeds"
  );
  expect(() =>
    parseImport('url,title\nhttps://garden.test/tea,"unfinished')
  ).toThrow("CSV Is Incomplete");
}, 30_000);
it("keeps malicious titles as text and rejects unsafe Sources", () => {
  const result = parseImport(
    'url,title\nhttps://garden.test/tea,"<img src=x onerror=alert(1)>"\njavascript:alert(1),Bad\nfile:///secret,Bad'
  );
  expect(result.items[0]?.title).toBe("<img src=x onerror=alert(1)>");
  expect(result.skipped).toBe(2);
});
it("does not mistake HTML-looking CSV titles for an HTML export", () => {
  const result = parseImport(
    'url,title\nhttps://garden.test/tea,"<a href=""https://wrong.test/"">Tea</a>"'
  );
  expect(result.items[0]?.url).toBe("https://garden.test/tea");
  expect(result.items[0]?.title).toBe('<a href="https://wrong.test/">Tea</a>');
});
