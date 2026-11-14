import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Drizzle's migrator applies a migration only if its journal `when` is later
// than the newest one already applied, so an out-of-order `when` is skipped in
// production without an error. These checks are pure: no database needed.

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

type Rule = "order" | "tag" | "duplicate" | "unjournaled";
interface Problem {
  rule: Rule;
  message: string;
}

const pad = (n: number) => String(n).padStart(4, "0");
const JOURNAL = "migrations/meta/_journal.json";

/** Pure: every way the journal and the .sql files can disagree. */
export function checkMigrations(
  entries: JournalEntry[],
  sqlFiles: string[]
): Problem[] {
  const problems: Problem[] = [];
  const add = (rule: Rule, message: string) => problems.push({ rule, message });
  const lastWhen = Math.max(0, ...entries.map((e) => e.when));
  const lastIdx = Math.max(-1, ...entries.map((e) => e.idx));
  const files = new Set(sqlFiles);

  // (a) strictly increasing idx and when
  entries.forEach((entry, i) => {
    const prev = entries[i - 1];
    if (!prev) return;
    if (entry.idx <= prev.idx)
      add(
        "order",
        `${entry.tag} has idx ${entry.idx}, not greater than ${prev.tag} (idx ${prev.idx}). Set its idx in ${JOURNAL} to ${prev.idx + 1} or higher.`
      );
    if (entry.when <= prev.when)
      add(
        "order",
        `${entry.tag} has when ${entry.when}, not greater than ${prev.tag} (when ${prev.when}). Drizzle would skip it in any database that already ran ${prev.tag}. Raise its when in ${JOURNAL} to ${Math.max(prev.when, lastWhen) + 1} or higher.`
      );
  });

  // (b) tag <-> file, prefix == idx
  for (const entry of entries) {
    const expected = pad(entry.idx);
    const prefix = /^(\d{4})_/.exec(entry.tag)?.[1];
    const name = entry.tag.replace(/^\d{4}_/, "");
    if (!files.has(`${entry.tag}.sql`))
      add(
        "tag",
        `Journal tag "${entry.tag}" (idx ${entry.idx}) has no migrations/${entry.tag}.sql. Rename the file to match the tag or fix the tag in ${JOURNAL}.`
      );
    if (prefix !== expected)
      add(
        "tag",
        `${entry.tag} has idx ${entry.idx}, so its prefix must be ${expected}. Rename migrations/${entry.tag}.sql to migrations/${expected}_${name}.sql and set its tag in ${JOURNAL} to "${expected}_${name}".`
      );
  }

  // (c) no duplicate numeric prefixes
  const byPrefix = new Map<string, string[]>();
  for (const file of sqlFiles) {
    const prefix = file.slice(0, 4);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
  }
  for (const [prefix, group] of byPrefix) {
    if (group.length < 2) continue;
    add(
      "duplicate",
      `${group.join(" and ")} share the prefix ${prefix}. Rename the one added later to ${pad(lastIdx + 1)}_<name>.sql, update its tag and idx (${lastIdx + 1}) in ${JOURNAL}, and raise its when above ${lastWhen}.`
    );
  }

  // (d) every .sql file has a journal entry
  const tags = new Set(entries.map((e) => e.tag));
  for (const file of sqlFiles)
    if (!tags.has(file.replace(/\.sql$/, "")))
      add(
        "unjournaled",
        `migrations/${file} has no entry in ${JOURNAL}. Add { idx: ${lastIdx + 1}, version: "7", when: ${lastWhen + 1}, tag: "${file.replace(/\.sql$/, "")}", breakpoints: true }, or delete the file.`
      );

  return problems;
}

const here = (path: string) => new URL(`../${path}`, import.meta.url);
const journal = JSON.parse(readFileSync(here(JOURNAL), "utf8")) as {
  entries: JournalEntry[];
};
const sqlFiles = readdirSync(here("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const problems = checkMigrations(journal.entries, sqlFiles);
const failing = (rule: Rule) =>
  problems.filter((p) => p.rule === rule).map((p) => p.message);

describe("migration journal", () => {
  it("has strictly increasing idx and when", () => {
    expect(failing("order")).toEqual([]);
  });

  it("matches each tag to a .sql file whose prefix is the zero-padded idx", () => {
    expect(failing("tag")).toEqual([]);
  });

  it("has no duplicate numeric prefixes among the .sql files", () => {
    expect(failing("duplicate")).toEqual([]);
  });

  it("has a journal entry for every .sql file", () => {
    expect(failing("unjournaled")).toEqual([]);
  });
});

describe("checkMigrations messages", () => {
  const entry = (idx: number, when: number, name: string): JournalEntry => ({
    idx,
    when,
    tag: `${pad(idx)}_${name}`,
  });

  it("is clean for a consistent journal", () => {
    const entries = [entry(0, 10, "a"), entry(1, 20, "b")];
    expect(checkMigrations(entries, ["0000_a.sql", "0001_b.sql"])).toEqual([]);
  });

  it("says which when to raise", () => {
    const entries = [entry(0, 100, "a"), entry(1, 50, "b")];
    expect(
      checkMigrations(entries, ["0000_a.sql", "0001_b.sql"]).map(
        (p) => p.message
      )
    ).toEqual([expect.stringContaining("Raise its when")]);
    expect(
      checkMigrations(entries, ["0000_a.sql", "0001_b.sql"])[0]!.message
    ).toContain("to 101 or higher");
  });

  it("says what to rename for a prefix that does not match idx", () => {
    const entries = [
      entry(0, 10, "a"),
      { ...entry(1, 20, "b"), tag: "0003_b" },
    ];
    const messages = checkMigrations(entries, ["0000_a.sql", "0003_b.sql"]).map(
      (p) => p.message
    );
    expect(messages).toEqual([
      expect.stringContaining(
        "Rename migrations/0003_b.sql to migrations/0001_b.sql"
      ),
    ]);
  });

  it("flags duplicate prefixes and unjournaled files", () => {
    const entries = [entry(0, 10, "a"), entry(1, 20, "b")];
    const found = checkMigrations(entries, [
      "0000_a.sql",
      "0001_b.sql",
      "0001_c.sql",
    ]);
    expect(found.map((p) => p.rule).sort()).toEqual([
      "duplicate",
      "unjournaled",
    ]);
    expect(found.find((p) => p.rule === "duplicate")!.message).toContain(
      "Rename the one added later to 0002_<name>.sql"
    );
  });
});
