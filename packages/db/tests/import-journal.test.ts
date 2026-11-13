import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("runs Import after every existing migration and the three pending 0028 migrations", async () => {
  const journal = JSON.parse(
    await readFile(
      new URL("../migrations/meta/_journal.json", import.meta.url),
      "utf8"
    )
  ) as { entries: { tag: string; when: number }[] };
  const imported = journal.entries.find(
    (entry) => entry.tag === "0029_import"
  )!;
  expect(imported.when).toBe(1794600000000);
  for (const when of [
    1794530000000,
    1794572552722,
    1794574105192,
    ...journal.entries
      .filter((entry) => entry !== imported)
      .map((entry) => entry.when),
  ])
    expect(imported.when).toBeGreaterThan(when);
});
