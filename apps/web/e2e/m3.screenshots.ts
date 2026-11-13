import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";
import type { Memory } from "../src/library/use-library";

// The #23 polish pass: every M3 Capture surface on hostile data, at 1440 and
// 390, light and dark. `M3_PHASE=before|after`, `M3_SCREENSHOTS=1`.
const OUT =
  process.env.M3_SCREENSHOT_DIR ??
  "/data/workspace/spark-memory/.git/factory/r";
const phase = process.env.M3_PHASE ?? "after";

const LONG =
  "Designing a Personal Library Across Languages, Devices, and Years "
    .repeat(5)
    .trim();
const RTL = "نور الهدى عبد الرحمن: كيف نحفظ الذكريات عبر السنين والأجهزة";
const EMOJI = "👩🏽‍💻 Garden 🌱🌻 notes 🧠📚";
const PAGE_SVG = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792"><rect width="612" height="792" fill="#fff"/><text x="40" y="80" font-size="32" fill="#111">Page ${n}</text></svg>`;

async function shot(page: Page, surface: string, width: number, theme: string) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: `${OUT}/t23-${phase}-${surface}-${width}-${theme}.png`,
  });
}

test("M3 surfaces on hostile data", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await page.request.post("/api/memories", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id: crypto.randomUUID(), body: "base", captureNote: null },
  });
  const {
    memories: [base],
  } = (await (await page.request.get("/api/memories")).json()) as {
    memories: Memory[];
  };
  const now = Date.now();
  let n = 0;
  const make = (extra: Partial<Memory>): Memory =>
    ({
      ...base!,
      id: crypto.randomUUID(),
      lastSavedAt: new Date(now - ++n * 1000).toISOString(),
      capturedAt: new Date(now - n * 1000).toISOString(),
      indexState: "searchable",
      indexError: null,
      title: "",
      body: null,
      description: null,
      pageTitle: null,
      ...extra,
    }) as Memory;
  const link = (name: string, extra: Partial<Memory>) =>
    make({ kind: "link", title: name, ...extra });
  const long = Array.from(
    { length: 6 },
    (_, i) =>
      `Paragraph ${i + 1}. ${"The garden wall faces south and holds the heat of the afternoon. ".repeat(6)}`
  ).join("\n\n");
  const transcript = Array.from({ length: 60 }, (_, i) => ({
    seconds: i * 37,
    text:
      i % 7 === 0
        ? RTL
        : `Segment ${i}. Heliotropism turns leaves towards sunlight across the day.`,
  }));
  const memories = [
    link("Long", {
      title: LONG,
      sourceUrl: "https://example.com/" + "a".repeat(200),
      body: long,
      description: LONG,
    }),
    link("Bare", {
      title: "",
      sourceUrl: "https://bare.example/x",
      preservation: "reference_only",
    }),
    link("RTL", {
      title: RTL,
      sourceUrl: "https://arabic.example/a",
      description: RTL,
      body: RTL + "\n\n" + RTL,
    }),
    link("Emoji", {
      title: EMOJI,
      sourceUrl: "https://emoji.example/a",
      description: EMOJI,
      body: EMOJI,
    }),
    link("Fetching", {
      title: "Fetching Page",
      sourceUrl: "https://thin.example/",
      deepFetch: "fetching",
      preservation: "reference_only",
      indexState: "indexing",
    }),
    link("Later", {
      title: "Fetching Later Page",
      sourceUrl: "https://later.example/",
      deepFetch: "waiting",
      preservation: "reference_only",
    }),
    link("Failed", {
      title: "Deep Fetch Failed Page",
      sourceUrl: "https://failed.example/",
      deepFetch: "failed",
      preservation: "reference_only",
    }),
    link("Unreadable", {
      title: "Failed Index",
      sourceUrl: "https://nope.example/",
      indexState: "failed",
      indexError: "unavailable",
    }),
    link("X post", {
      title: "Ana Pérez on X",
      sourceUrl: "https://x.com/anaperez/status/1850000000000000001",
      body: "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled.",
      description: "Shipped the new onboarding today.",
    }),
    make({
      kind: "video",
      title: "Garden Film",
      sourceUrl: "https://youtu.be/abcdefghijk?t=30",
      video: { transcriptState: "available", transcript },
    }),
    make({
      kind: "video",
      title: "Empty Transcript " + LONG,
      sourceUrl: "https://youtu.be/abcdefghijl",
      video: { transcriptState: "unavailable", transcript: [] },
      description: RTL,
    }),
    make({
      kind: "video",
      title: "Long Lecture",
      sourceUrl: "https://youtu.be/abcdefghijm",
      video: { transcriptState: "over_allowance", transcript: [] },
    }),
    make({
      kind: "video",
      title: "Reel",
      sourceUrl: "https://www.instagram.com/reel/Cabc123/",
      video: {
        transcriptState: "available",
        transcript: transcript.slice(0, 3),
      },
    }),
    make({
      kind: "pdf",
      title: "A Very Long Report " + LONG,
      pages: 500,
      image: {
        width: 612,
        height: 792,
        thumbhash: null,
        url: "/m3-page-1.svg",
        thumbnailUrl: "/m3-page-1.svg",
      } as unknown as Memory["image"],
    }),
    make({
      kind: "pdf",
      title: "",
      pages: 3,
      image: {
        width: 612,
        height: 792,
        thumbhash: null,
        url: "/m3-broken.svg",
        thumbnailUrl: "/m3-broken.svg",
      } as unknown as Memory["image"],
    }),
  ];
  await page.route(/\/m3-page-(\d+)\.svg/, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: PAGE_SVG(Number(/page-(\d+)/.exec(route.request().url())![1])),
    })
  );
  await page.route("**/m3-broken.svg", (route) => route.abort());
  await page.route("**/api/memories/*/pages", (route) =>
    route.fulfill({
      json: {
        pages: Array.from({ length: 30 }, (_, i) => ({
          page: i + 1,
          url: i === 2 ? "/m3-broken.svg" : `/m3-page-${i + 1}.svg`,
          width: 612,
          height: 792,
        })),
      },
    })
  );
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { memories, unfinished: [] } })
      : route.fallback()
  );
  await page.route("**/api/memories?*", (route) =>
    route.fulfill({ json: { memories: [] } })
  );

  const at = (i: number) => memories[i]!;
  const surfaces = [
    ["reader-long", at(0)],
    ["reader-bare", at(1)],
    ["reader-rtl", at(2)],
    ["reader-emoji", at(3)],
    ["deep-fetching", at(4)],
    ["deep-later", at(5)],
    ["deep-failed", at(6)],
    ["reader-social", at(8)],
    ["video", at(9)],
    ["video-empty", at(10)],
    ["video-over", at(11)],
    ["reel", at(12)],
    ["pdf", at(13)],
  ] as const;

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.reload();
      const wall = page.getByRole("list", { name: "All Memories" });
      await expect(wall).toBeVisible({ timeout: 30_000 });
      await shot(page, "wall", width, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);

      // Capture a link.
      await page
        .getByRole("button", { name: "Capture", exact: true })
        .first()
        .click();
      await page
        .getByRole("textbox", { name: "Text" })
        .fill("https://example.com/" + "long-segment/".repeat(12));
      await shot(page, "capture", width, theme);
      await page.keyboard.press("Escape");

      for (const [surface, memory] of surfaces) {
        const name = memory.title || new URL(memory.sourceUrl!).host;
        const tile = wall
          .getByRole("listitem", {
            name: new RegExp(
              name.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            ),
          })
          .first();
        await tile.scrollIntoViewIfNeeded();
        await tile.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await shot(page, surface, width, theme);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      }
    }
  }

  // Keyboard only: every Tab stop in each surface shows a focus indicator.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall).toBeVisible();
  const stops = async () => {
    const seen: string[] = [];
    const bare: string[] = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return undefined;
        const css = getComputedStyle(el);
        const visible =
          (css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0) ||
          (css.boxShadow !== "none" && css.boxShadow !== "");
        const name =
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 30) ||
          el.tagName;
        return { name: `${el.tagName.toLowerCase()} ${name}`, visible };
      });
      if (!info) break;
      if (seen.includes(info.name)) break;
      seen.push(info.name);
      if (!info.visible) bare.push(info.name);
    }
    return { seen, bare };
  };
  for (const [surface, memory] of surfaces) {
    const name = memory.title || new URL(memory.sourceUrl!).host;
    await wall
      .getByRole("listitem", {
        name: new RegExp(
          name.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        ),
      })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const { seen, bare } = await stops();
    console.log(`keyboard ${surface}: ${seen.join(" | ")}`);
    expect(bare, `${surface} stops with no visible focus`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});
