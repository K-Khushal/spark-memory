import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSet } from "./manifest";

const item = (id: string) => ({
  id,
  kind: "text",
  title: id,
  text: `texts/${id}.txt`,
  tags: [],
  language: "en",
  source: { type: "owner", url: "", licence: "mine", attribution: "me" },
});

/** A library/ and searches/ folder with the files given as name to JSON. */
async function folder(
  library: Record<string, unknown>,
  searches: Record<string, unknown>
) {
  const root = await mkdtemp(join(tmpdir(), "evals-"));
  for (const [dir, files] of [
    ["library", library],
    ["searches", searches],
  ] as const) {
    await mkdir(join(root, dir));
    for (const [name, data] of Object.entries(files)) {
      await writeFile(join(root, dir, name), JSON.stringify(data));
    }
  }
  return root;
}

describe("the committed sample set", () => {
  it("is valid: every search expects a Memory that exists, with a licence on each Memory", async () => {
    const { items, searches } = await loadSet();
    expect(items.length).toBeGreaterThanOrEqual(140);
    expect(searches.length).toBeGreaterThanOrEqual(30);
    for (const i of items) {
      expect(i.source.licence, i.id).not.toBe("");
      expect(i.source.attribution, i.id).not.toBe("");
    }
  });
});

describe("dropping in the owner's searches", () => {
  it("reads every searches/*.json and library/*.json without code changes", async () => {
    const root = await folder(
      { "manifest.json": [item("a")], "owner.json": [item("b")] },
      {
        "tricky.json": [{ id: "t1", query: "q", expect: ["a"], kind: "x" }],
        "owner.json": [{ id: "o1", query: "q", expect: ["b"], kind: "visual" }],
      }
    );
    const { items, searches } = await loadSet(root);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(searches.map((s) => s.id)).toEqual(["o1", "t1"]);
  });

  it("refuses a search that expects a Memory the Library does not have", async () => {
    const root = await folder(
      { "manifest.json": [item("a")] },
      {
        "owner.json": [
          { id: "o1", query: "q", expect: ["missing"], kind: "x" },
        ],
      }
    );
    await expect(loadSet(root)).rejects.toThrow(/unknown Memory missing/);
  });

  it("refuses two searches with one id", async () => {
    const s = { id: "same", query: "q", expect: ["a"], kind: "x" };
    const root = await folder(
      { "manifest.json": [item("a")] },
      { "one.json": [s], "two.json": [s] }
    );
    await expect(loadSet(root)).rejects.toThrow(/share an id/);
  });
});
