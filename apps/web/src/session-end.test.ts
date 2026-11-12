import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEndSession } from "./session-end";
import { clearSearchCache, searchCache } from "./library/search-session";

describe("ending a session", () => {
  it("runs every cleanup, even after one fails", () => {
    const first = vi.fn(() => {
      throw new Error("analytics blocked");
    });
    const second = vi.fn();
    createEndSession([first, second])();
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("forgets every search answer this tab holds", () => {
    searchCache.set("ana|1|q:purple", { hits: [] });
    clearSearchCache();
    expect(searchCache.size).toBe(0);
  });

  it("clears a held share and foreign caches", () => {
    const auth = readFileSync(join(__dirname, "auth.ts"), "utf8");
    expect(auth).toMatch(/clearHeldShares/);
    expect(auth).toMatch(/clearUserCaches/);
  });

  /** Source files (not tests) under src/. */
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  /** The source of `function name` (or `const name = …`) in `file`, to its own closing brace. */
  const body = (file: string, name: string) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    const found = new RegExp(
      `^( *)(?:export )?(?:async )?(?:function|const) ${name}\\b`,
      "m"
    ).exec(source);
    expect(found, `${name} in ${file}`).not.toBeNull();
    const rest = source.slice(found!.index);
    const end = rest.indexOf(`\n${found![1]}}`);
    return end < 0 ? rest : rest.slice(0, end);
  };

  it.each([
    ["Sign Out (sidebar, Settings)", "shell.tsx", "useSignOut"],
    ["Sign Out Everywhere", "settings/use-account.ts", "signOutEverywhere"],
    ["Delete Account", "settings/use-account.ts", "deleteAccount"],
    ["Sign Out (Library)", "library/library-page.tsx", "signOut"],
    ["Sign Out (Admin)", "admin/admin-page.tsx", "signOut"],
  ])("%s ends the session", (_, file, name) => {
    expect(body(file, name)).toMatch(/\bendSession\(\)/);
  });

  it("is called wherever else a session ends", () => {
    const ending =
      /authClient\.signOut\(|\["sign-out-everywhere"\]|account\s*\.\$delete\(/;
    const files = sources(join(__dirname)).filter((path) =>
      ending.test(readFileSync(path, "utf8"))
    );
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const path of files) {
      expect(readFileSync(path, "utf8"), path).toMatch(/\bendSession\(\)/);
    }
  });
});
