import { describe, expect, it } from "vitest";
import { fixedParts, zipStream, type ZipEntry } from "../src/zip";
import { unzip } from "./unzip";

async function collect(chunks: AsyncIterable<Uint8Array>) {
  const all: Uint8Array[] = [];
  for await (const c of chunks) all.push(c);
  return all;
}
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};
const entry = (name: string, chunks: Uint8Array[] | undefined): ZipEntry => ({
  name,
  modified: new Date("2026-11-11T10:20:30Z"),
  body: async () =>
    chunks &&
    (async function* () {
      yield* chunks;
    })(),
});

describe("zipStream", () => {
  it("writes entries an unzip tool reads back byte for byte, in pieces", async () => {
    const big = crypto.getRandomValues(new Uint8Array(50_000));
    const zip = join(
      await collect(
        zipStream([
          entry("memories.json", [
            new TextEncoder().encode('[{"title":"Café ☕"}]'),
          ]),
          entry("files/a.png", [big.subarray(0, 7), big.subarray(7)]),
          entry("files/gone.png", undefined),
          entry("files/empty.txt", []),
        ])
      )
    );
    const files = unzip(zip);
    expect([...files.keys()]).toEqual([
      "memories.json",
      "files/a.png",
      "files/empty.txt",
    ]);
    expect(new TextDecoder().decode(files.get("memories.json"))).toBe(
      '[{"title":"Café ☕"}]'
    );
    expect(files.get("files/a.png")).toEqual(big);
    expect(files.get("files/empty.txt")).toEqual(new Uint8Array());
  });

  it("writes an empty archive for an empty Library", async () => {
    const zip = join(await collect(zipStream([])));
    expect(unzip(zip).size).toBe(0);
  });
});

describe("fixedParts", () => {
  it("cuts any chunks into equal parts, only the last smaller", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(1000));
    const chunks = (async function* () {
      for (let i = 0; i < 1000; i += 37) yield bytes.subarray(i, i + 37);
    })();
    const parts = await collect(fixedParts(chunks, 128));
    expect(parts.slice(0, -1).every((p) => p.length === 128)).toBe(true);
    expect(parts.at(-1)!.length).toBe(1000 % 128);
    expect(join(parts)).toEqual(bytes);
  });
});
