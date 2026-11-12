import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";
import type { Memory } from "../src/library/use-library";

const OUT = "/data/workspace/spark-memory/.git/factory/r";
const phase = process.env.POLISH_PHASE ?? "after";
const titles = [
  "Designing a Personal Library Across Languages, Devices, and Years: "
    .repeat(4)
    .slice(0, 300),
  "नमस्ते दुनिया, यादों की लाइब्रेरी",
  "日本語のデザイン資料",
  "نور الهدى عبد الرحمن",
  "👩🏽‍💻 Design 🧠 📚",
  "J",
];

async function screenshot(
  page: Page,
  surface: string,
  width: number,
  theme: string
) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: `${OUT}/t9-${phase}-${surface}-${width}-${theme}.png`,
  });
}

test("M1 surfaces and worst-case local Library", async ({ page, context }) => {
  test.setTimeout(300_000);

  await signIn(page);
  await page.request.post("/api/memories", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      id: crypto.randomUUID(),
      body: "Cardamom buns with orange zest",
      captureNote: null,
    },
  });
  const {
    memories: [base],
  } = (await (await page.request.get("/api/memories")).json()) as {
    memories: Memory[];
  };
  const memories = Array.from({ length: 10_000 }, (_, i): Memory => ({
    ...base!,
    id: crypto.randomUUID(),
    lastSavedAt: new Date(Date.now() - (i + 1) * 1000).toISOString(),
    title: titles[i % titles.length]!,
    body:
      i % 2
        ? "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved\n".repeat(
            12
          )
        : "A recipe worth remembering.\n".repeat(20),
    indexState:
      i % 3 === 0 ? "failed" : i % 3 === 1 ? "indexing" : "searchable",
    indexError: i % 3 === 0 ? "unavailable" : null,
  }));
  const image = {
    ...base!,
    id: crypto.randomUUID(),
    kind: "image" as const,
    title: "Image",
    lastSavedAt: new Date(Date.now() + 1000).toISOString(),
    indexState: "failed" as const,
    indexError: "unavailable" as const,
    image: {
      width: 640,
      height: 480,
      thumbhash: null,
      url: "/polish-image.svg",
      thumbnailUrl: "/polish-image.svg",
    },
  };
  await page.route("**/polish-image.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#24774A"/><circle cx="320" cy="240" r="120" fill="#FFE15A"/></svg>',
    })
  );
  let huge = false;
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            memories:
              new URL(page.url()).searchParams.get("data") === "Empty"
                ? []
                : new URL(page.url()).searchParams.get("data") === "Demo Data"
                  ? [base]
                  : [image, ...(huge ? memories : memories.slice(0, 24))],
            unfinished: [],
          },
        })
      : route.fallback()
  );
  await page.route("**/api/memories?*", (route) =>
    route.fulfill({ json: { memories: [] } })
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.reload();
      const wall = page.getByRole("list", { name: "All Memories" });
      await expect(wall).toBeVisible({ timeout: 30_000 });
      await expect(wall.getByRole("listitem").first()).toBeVisible();
      expect(await wall.getByRole("listitem").count()).toBeLessThan(100);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await screenshot(page, "wall", width, theme);
      await page
        .getByRole("listitem", { name: "Image, Indexing Failed", exact: true })
        .click();
      await screenshot(page, "viewer", width, theme);
      if (phase === "after" && width === 390) {
        const badge = await page
          .getByText("Indexing Unavailable", { exact: true })
          .boundingBox();
        const control = await page
          .getByRole("switch", { name: "AI Opt-Out" })
          .boundingBox();
        expect(badge!.y).toBeGreaterThanOrEqual(control!.y + control!.height);
      }
      await page.keyboard.press("Escape");
      await wall.getByRole("listitem").nth(1).click();
      await screenshot(page, "detail", width, theme);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Capture", exact: true })
        .first()
        .click();
      await screenshot(page, "capture", width, theme);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+k");
      await screenshot(page, "search", width, theme);
      await page.keyboard.press("Escape");
    }
  }
  huge = true;
  // Test-only dataset picker: the production app never receives this chrome.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const nav = document.createElement("nav");
      nav.ariaLabel = "Polish Test Data";
      nav.style.cssText =
        "position:fixed;bottom:8px;left:8px;z-index:100;background:var(--surface);color:var(--ink);padding:8px;display:flex;gap:12px";
      for (const label of ["Demo Data", "Worst Case", "Empty"]) {
        const link = document.createElement("a");
        link.textContent = label;
        link.href = `/?data=${encodeURIComponent(label)}`;
        nav.append(link);
      }
      document.body.append(nav);
    });
  });
  // Cold Library on a slow connection; no accidental empty-state flash.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 500,
    downloadThroughput: 1_000_000,
    uploadThroughput: 20_000,
  });
  await page.reload();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible();
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.getByRole("listitem").nth(1).click();
  await screenshot(page, "detail-large-text", 320, "dark");
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("listitem").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(async () =>
      page.getByRole("listitem").last().getAttribute("data-index")
    )
    .toBe("10000");
  await page.getByRole("link", { name: "Empty", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  await screenshot(page, "empty", 320, "dark");
  await page.getByRole("link", { name: "Demo Data", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("toast focus at both widths and themes", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Library", exact: true })
      ).toBeAttached();
      await page.evaluate((body) => {
        const data = new DataTransfer();
        data.setData("text/plain", body);
        document.body.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
        );
      }, `Toast focus ${width} ${theme}`);
      await expect(page.getByText("Captured", { exact: true })).toBeVisible();
      await page.keyboard.press("Alt+t");
      await page.keyboard.press("Tab");
      await screenshot(page, "toast", width, theme);
      await page.keyboard.press("Escape");
    }
  }
});
