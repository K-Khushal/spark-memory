import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSet, refuseOwnerMemories } from "./manifest";
import type { SampleMemory } from "./manifest";

const sample = (id: string) => ({
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
    const { memories, searches } = await loadSet();
    expect(memories.length).toBeGreaterThanOrEqual(140);
    expect(searches.length).toBeGreaterThanOrEqual(30);
    for (const i of memories) {
      expect(i.source.licence, i.id).not.toBe("");
      expect(i.source.attribution, i.id).not.toBe("");
    }
  });
});

describe("dropping in the owner's searches", () => {
  it("reads every searches/*.json and library/*.json without code changes", async () => {
    const root = await folder(
      { "manifest.json": [sample("a")], "owner.json": [sample("b")] },
      {
        "tricky.json": [{ id: "t1", query: "q", expect: ["a"], kind: "x" }],
        "owner.json": [{ id: "o1", query: "q", expect: ["b"], kind: "visual" }],
      }
    );
    const { memories, searches } = await loadSet(root);
    expect(memories.map((i) => i.id)).toEqual(["a", "b"]);
    expect(searches.map((s) => s.id)).toEqual(["o1", "t1"]);
  });

  it("refuses a search that expects a Memory the Library does not have", async () => {
    const root = await folder(
      { "manifest.json": [sample("a")] },
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
      { "manifest.json": [sample("a")] },
      { "one.json": [s], "two.json": [s] }
    );
    await expect(loadSet(root)).rejects.toThrow(/share an id/);
  });
});

describe("sending the Library to outside services", () => {
  const memory = (type: SampleMemory["source"]["type"]) =>
    ({
      ...sample("a"),
      source: { type, url: "", licence: "x", attribution: "x" },
    }) as SampleMemory;

  it("is fine for the openly licensed sample", () => {
    expect(() =>
      refuseOwnerMemories([memory("commons"), memory("original")], "x")
    ).not.toThrow();
  });

  it("stops when the owner's own Memories are in the Library", () => {
    expect(() =>
      refuseOwnerMemories(
        [memory("commons"), memory("owner")],
        "the comparison"
      )
    ).toThrow(/owner's own Memories/);
  });
});
