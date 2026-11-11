import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("bundle split", () => {
  const router = src("router.tsx");
  const library = src("library/library-page.tsx");

  it.each([
    ["/admin", "./admin/route"],
    ["/settings", "./settings/route"],
    ["/sign-in", "./sign-in/route"],
    ["/prototypes", "./prototypes/route"],
  ] as const)("%s is a lazy route", (path, chunk) => {
    expect(router).toMatch(
      new RegExp(
        `path: "${path.replaceAll("/", "\\/")}"[\\s\\S]*?\\.lazy\\(\\(\\) => import\\("${chunk.replaceAll("/", "\\/")}"`
      )
    );
  });

  it("keeps the Library on the first paint", () => {
    expect(router).toMatch(
      /import \{ LibraryPage \} from "\.\/library\/library-page"/
    );
    const library = /const libraryRoute = createRoute\(\{[\s\S]*?\n\}\);/.exec(
      router
    );
    expect(library?.[0]).toMatch(/path: "\/"/);
    expect(library?.[0]).not.toMatch(/\.lazy\(/);
  });

  it("loads ⌘K, dialogs and motion after first paint", () => {
    const host = src("library/overlays-host.tsx");
    expect(library).toMatch(/from "\.\/overlays-host"/);
    expect(host).toMatch(/import\("\.\/overlays"\)/);
    expect(host).toMatch(/lazy\(loadOverlays\)/);
    expect(host).toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(host).toMatch(/getDerivedStateFromError/);
    expect(library).not.toMatch(/from "motion\/react"/);
    expect(library).not.toMatch(/CommandDialog/);
    expect(library).not.toMatch(/from "\.\/image-viewer"/);
    expect(library).not.toMatch(/from "\.\/paste-box"/);
    expect(library).not.toMatch(/from "\.\/memory-detail"/);
    expect(library).not.toMatch(/from "\.\/overlays"/);
  });
});
