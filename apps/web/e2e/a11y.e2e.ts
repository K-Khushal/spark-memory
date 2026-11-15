import { chromium, expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fromOwnAddress, signIn, stubTurnstile } from "./sign-in";
import { dropImage, dropPdf, paste, scan, settle } from "./a11y-support";

// WCAG 2.2 AA, scanned by axe on every screen and state, in light and dark,
// on a desktop (1440) and a phone (390). A new violation fails this file, so
// the app cannot regress without a person choosing to. Each cell of the
// matrix signs in once and walks every state with shared seeding.
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1440, 390] as const;

async function frame(
  page: Page,
  theme: (typeof THEMES)[number],
  width: number
) {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
  await page.emulateMedia({ colorScheme: theme });
}

/**
 * A tile by name, opened from the keyboard: focus it (walking down the wall
 * when it is not drawn yet, as the wall is virtualised) and press Enter.
 */
async function openTile(page: Page, name: RegExp) {
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name });
  if ((await tile.count()) === 0) {
    await wall.getByRole("listitem").first().focus();
    for (let step = 0; step < 20 && (await tile.count()) === 0; step++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
    }
  }
  // Target the tile at key delivery time; dialog focus restoration can
  // otherwise move focus back to the previously opened Memory.
  await tile.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeDialog(page: Page, returnToWall = false) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (returnToWall) {
    // Viewer close restores focus through two animation frames after unmount.
    // Wait for that handoff before focusing another tile, or it can steal Enter.
    await expect(
      page
        .getByRole("list", { name: "All Memories" })
        .locator('[role="listitem"][tabindex="0"]')
    ).toBeFocused();
  } else {
    await settle(page);
  }
}

/** A small real PNG as the query image of a search by image. */
async function queryImage(page: Page) {
  const data = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(96, 64);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fe0";
    context.fillRect(0, 0, 96, 64);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return {
    name: "query.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const cell = `${theme} ${width}`;

    test(`axe: signed-out screens, ${cell}`, async ({ page }) => {
      await frame(page, theme, width);
      await stubTurnstile(page);
      await fromOwnAddress(page);
      await page.goto("/sign-in");
      await expect(
        page.getByRole("button", { name: "Continue with Email" })
      ).toBeVisible();
      await scan(page, `sign-in, ${cell}`);
      await page.getByPlaceholder("Email").fill("axe@example.com");
      await page.getByRole("button", { name: "Continue with Email" }).click();
      await expect(
        page.getByRole("heading", { name: "Check Your Email" })
      ).toBeVisible();
      await scan(page, `sign-in code step, ${cell}`);
      await page.goto("/offline.html");
      await scan(page, `offline, ${cell}`);
    });

    test(`axe: Library, search and viewers, ${cell}`, async ({ page }) => {
      test.setTimeout(240_000);
      await frame(page, theme, width);
      // A recorded Gather result, so the video needs no network.
      await page.route("**/api/memories*", async (route) => {
        const response = await route.fetch();
        if (route.request().method() !== "GET")
          return route.fulfill({ response });
        const data = await response.json();
        const decorate = (m: Record<string, unknown>) =>
          m.kind === "video"
            ? {
                ...m,
                indexState: "searchable",
                pageTitle: "Garden Film",
                video: {
                  transcriptState: "available",
                  transcript: [
                    { seconds: 0, text: "Welcome to this garden." },
                    {
                      seconds: 760,
                      text: "Heliotropism turns leaves towards sunlight.",
                    },
                  ],
                },
              }
            : m;
        await route.fulfill({
          response,
          json: Array.isArray(data.memories)
            ? { ...data, memories: data.memories.map(decorate) }
            : decorate(data),
        });
      });
      await signIn(page);
      const scanned = (label: string) => scan(page, `${label}, ${cell}`);
      await scanned("new Library with Get Started");

      // Shared seeding: a note, a list, a link, an image, a PDF and a video.
      await paste(page, "Lemon tart with a salted shortcrust, from Grandma");
      await paste(page, "# Packing list\nPassport\nCharger\nSunscreen");
      await paste(page, "https://example.com/?utm_source=axe");
      await paste(page, "https://youtu.be/abcdefghijk?t=30");
      await expect
        .poll(async () =>
          (
            await (await page.request.get("/api/memories")).json()
          ).memories.some((m: { kind: string }) => m.kind === "video")
        )
        .toBe(true);
      // Reloaded for the recorded video; the uploads follow, so none is cut short.
      await page.reload();
      const wall = page.getByRole("list", { name: "All Memories" });
      await expect(
        wall.getByRole("listitem", { name: /Lemon tart/ })
      ).toBeVisible();
      await dropImage(page);
      await dropPdf(page, "Quarterly report on lemon tarts");
      await expect(
        wall.getByRole("listitem", { name: /Lemon tart/ })
      ).toBeVisible();
      await expect(
        wall.getByRole("listitem", { name: /Garden Film/ })
      ).toBeVisible();
      await expect(wall.locator("img").first()).toBeVisible();
      await scanned("Library wall");

      // Capture
      await page
        .getByRole("button", { name: "Capture", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scanned("Capture dialog");
      await closeDialog(page);

      // Search: the menu, then the wall.
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill("lemon");
      await expect(
        page.getByRole("option", { name: /Lemon tart/ })
      ).toBeVisible();
      await scanned("Search menu with instant results");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("list", { name: "Direct Matches" })
      ).toBeVisible();
      await scanned("Search results on the wall");
      await page
        .getByRole("button", { name: "Clear Search" })
        .filter({ visible: true })
        .first()
        .click();

      // Search with no Direct Matches shows filter chips over Related ones.
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill("zzzz nothing like this");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: /No Direct Matches/ })
      ).toBeVisible({ timeout: 15_000 });
      await scanned("Search with no Direct Matches");
      await page
        .getByRole("button", { name: "Clear Search" })
        .filter({ visible: true })
        .first()
        .click();

      // Search by image: the query image's chip in the menu, then its results.
      await page.keyboard.press("Control+k");
      const menu = page.getByRole("dialog");
      await menu
        .getByLabel("Query Image File")
        .setInputFiles(await queryImage(page));
      await expect(
        menu.getByRole("button", { name: "Remove Query Image" })
      ).toBeVisible();
      await scanned("Search menu with a query image");
      await menu.getByPlaceholder("Search…").fill("lemon");
      await expect(
        menu.getByRole("option", { name: /Lemon tart/ })
      ).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("list", { name: /Matches$/ }).first()
      ).toBeVisible({ timeout: 15_000 });
      await scanned("Search by image results on the wall");
      await page
        .getByRole("button", { name: "Clear Search" })
        .filter({ visible: true })
        .first()
        .click();

      // A search that fails says so in the menu and on the wall.
      await page.route("**/api/search", (route) =>
        route.request().postDataJSON()?.q?.trim() === "boom"
          ? route.fulfill({ status: 500, json: {} })
          : route.fallback()
      );
      await page.keyboard.press("Control+k");
      await page.getByPlaceholder("Search…").fill("boom");
      await expect(
        page
          .getByRole("dialog")
          .getByRole("listbox")
          .getByText("Search Is Unreachable")
      ).toBeVisible();
      await scanned("Search failing in the menu");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Search Is Unreachable" })
      ).toBeVisible();
      await scanned("Search failing on the wall");
      await page
        .getByRole("button", { name: "Clear Search" })
        .filter({ visible: true })
        .first()
        .click();
      await page.unroute("**/api/search");

      // Memory detail, with More Like This once it has vectors.
      await openTile(page, /Lemon tart/);
      await scanned("Memory detail");
      const similar = page.getByRole("button", {
        name: "More Like This",
        exact: true,
      });
      await expect(similar).toBeVisible({ timeout: 20_000 });
      await similar.click();
      // The wall may hold few look-alikes; it is on the wall either way.
      await expect(
        page.getByRole("list", { name: "More Like This" })
      ).toBeAttached({ timeout: 15_000 });
      await scanned("More Like This on the wall");
      await page
        .getByRole("button", { name: "Clear Search" })
        .filter({ visible: true })
        .first()
        .click();

      // The viewers.
      await openTile(page, /^(Image|Fake Image Title)/);
      await scanned("Image viewer");
      await closeDialog(page);
      await openTile(page, /scan|Quarterly/);
      await scanned("PDF viewer");
      await closeDialog(page);
      await openTile(page, /Example Domain|example\.com/);
      await scanned("Link reader");
      await closeDialog(page, true);
      await openTile(page, /Garden Film/);
      await expect(
        page.getByRole("button", { name: /^Play At/i }).first()
      ).toBeVisible();
      await scanned("Video reader");
      await closeDialog(page, true);

      // Categories and bulk edit.
      await page
        .getByRole("button", { name: "Manage Categories" })
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page.getByRole("dialog", { name: "Categories", exact: true })
      ).toBeVisible();
      await scanned("Categories manager");
      await closeDialog(page);
      await wall.getByRole("listitem").first().focus();
      await page.keyboard.press("Control+a");
      await expect(
        page.getByRole("region", { name: "Selection", exact: true })
      ).toBeVisible();
      await scanned("Bulk selection bar");
      await page
        .getByRole("region", { name: "Selection", exact: true })
        .getByRole("button", { name: "Categories", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scanned("Bulk Categories picker");
      await closeDialog(page);
      await page.keyboard.press("Escape");

      // The Library that cannot load.
      await page.route("**/api/memories", (route) =>
        route.request().method() === "GET" ? route.abort() : route.fallback()
      );
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Library Is Unreachable" })
      ).toBeVisible();
      await scanned("Library unreachable");
    });

    test(`axe: Settings, share and failures, ${cell}`, async ({ page }) => {
      test.setTimeout(120_000);
      await frame(page, theme, width);
      await signIn(page);
      const scanned = (label: string) => scan(page, `${label}, ${cell}`);
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Settings" })
      ).toBeVisible();
      await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
      await scanned("Settings");
      await page
        .getByRole("button", { name: "Connection Guide", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Connection Guide" })
      ).toBeVisible();
      await scanned("Connection Guide");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Delete Account", exact: true })
        .click();
      await scanned("Delete Account confirmation");
      await page.keyboard.press("Escape");

      // Meters full, an import paused, an assistant listed.
      await page.route("**/api/usage", (route) =>
        route.fulfill({
          json: {
            storage: { used: 950_000_000, limit: 1_000_000_000 },
            captures: { used: 100, limit: 100 },
            deepFetches: { used: 20, limit: 20 },
            resetsAt: "2026-12-01T00:00:00Z",
            largest: [
              {
                id: "large",
                kind: "pdf",
                title: "Annual Report",
                sourceUrl: null,
                bytes: 25_000_000,
              },
            ],
          },
        })
      );
      await page.route("**/api/assistants", (route) =>
        route.fulfill({
          json: {
            assistants: [
              { id: "a", name: "Claude Desktop", lastActiveAt: null },
            ],
          },
        })
      );
      await page.route("**/api/imports/latest", (route) =>
        route.fulfill({
          json: {
            job: {
              id: "i",
              state: "paused",
              total: 10_000,
              loaded: 10_000,
              done: 1284,
              skipped: 1,
              spread: true,
              availableAt: "2026-12-01T00:00:00Z",
            },
          },
        })
      );
      await page.goto("/settings");
      await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
      await scanned("Settings with full meters and a paused import");
      await page.unroute("**/api/usage");

      // Settings that cannot load.
      await page.route("**/api/usage", (route) => route.abort());
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Settings Are Unreachable" })
      ).toBeVisible();
      await scanned("Settings unreachable");
      await page.unroute("**/api/usage");

      // A share held for confirmation.
      await page.goto("/");
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("spark-share", 2);
            request.onupgradeneeded = () =>
              request.result.createObjectStore("pending", {
                autoIncrement: true,
              });
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("pending", "readwrite");
              tx.objectStore("pending").add({
                id: crypto.randomUUID(),
                verified: false,
                title: "",
                text: Array.from(
                  { length: 30 },
                  (_, i) => `Shared step ${i + 1}`
                ).join("\n"),
                url: "",
                files: [],
              });
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
          })
      );
      await page.reload();
      await expect(
        page.getByRole("dialog", { name: "Capture This Share?" })
      ).toBeVisible();
      await scanned("share confirmation");
    });

    test(`axe: Admin, ${cell}`, async ({ page }) => {
      await frame(page, theme, width);
      await signIn(page, "admin@example.test");
      await page.goto("/admin");
      await expect(
        page.getByRole("heading", { name: "Admin", level: 1 })
      ).toBeVisible();
      await scan(page, `Admin, ${cell}`);
      await page.route("**/api/admin/summary", (route) => route.abort());
      await page.goto("/admin");
      await expect(
        page.getByRole("heading", { name: "Admin Is Unreachable" })
      ).toBeVisible();
      await scan(page, `Admin unreachable, ${cell}`);
    });
  }
}

test("axe: the extension popup", async () => {
  test.setTimeout(90_000);
  test.skip(
    process.env.EXTENSION_E2E !== "1",
    "Requires the local unpacked test build"
  );
  const profile = await mkdtemp(resolve(tmpdir(), "spark-axe-extension-"));
  const extension = resolve("../extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    for (const theme of ["light", "dark"] as const) {
      const popup = await context.newPage();
      await popup.emulateMedia({ colorScheme: theme });
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await expect(popup.getByRole("status")).toBeVisible();
      await scan(popup, `extension popup, ${theme}`);
      await popup.close();
    }
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

// Reflow (1.4.10) and text resize (1.4.4): at 320px with the root text at
// 200%, nothing is cut off sideways and every dialog fits the screen.
test("320px at 200% text: every screen reflows without sideways scrolling", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 640 });
  const large = () =>
    page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const fits = async (label: string) => {
    await settle(page);
    const overflow = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth - innerWidth;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const box = dialog?.getBoundingClientRect();
      return {
        wide,
        dialogOut: box ? box.left < -1 || box.right > innerWidth + 1 : false,
      };
    });
    expect.soft(overflow, label).toEqual({ wide: 0, dialogOut: false });
  };

  await page.goto("/sign-in");
  await large();
  await fits("sign-in");

  await signIn(page);
  await large();
  await fits("new Library with Get Started");
  await paste(page, "Lemon tart with a salted shortcrust, from Grandma");
  await paste(page, "https://example.com/?utm_source=axe");
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(
    wall.getByRole("listitem", { name: /Lemon tart/ })
  ).toBeVisible();
  await fits("Library wall");

  await page
    .getByRole("button", { name: "Capture", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fits("Capture dialog");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("lemon");
  await expect(page.getByRole("option", { name: /Lemon tart/ })).toBeVisible();
  await fits("Search menu");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Direct Matches" })
  ).toBeVisible();
  await fits("Search results");
  await page.getByRole("button", { name: "Clear Search" }).click();

  await wall.getByRole("listitem", { name: /Lemon tart/ }).dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fits("Memory detail");
  await page.keyboard.press("Escape");

  await wall.getByRole("listitem").first().focus();
  await page.keyboard.press("Control+a");
  await fits("Selection bar");
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  await large();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await fits("Settings");
});

// 2.3.3 / the Motion rule: reduced motion removes every scale and slide.
test("reduced motion: nothing scales or slides", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  // CSS keeps a Capture's scale-in running but pins `scale` to none, so what
  // counts is a running animation whose target still ends up scaled or moved.
  const moving = () =>
    page.evaluate(() =>
      document.getAnimations().flatMap((a) => {
        const effect = a.effect as KeyframeEffect;
        const target = effect.target as HTMLElement;
        const style = getComputedStyle(target);
        return Object.keys(effect.getKeyframes()[0] ?? {}).filter(
          (property) =>
            /^(scale|translate|rotate)$/.test(property) &&
            style.getPropertyValue(property) !== "none"
        );
      })
    );
  await paste(page, "A Memory that lands on the wall");
  await expect(page.getByText("Captured")).toBeVisible();
  expect(await moving()).toEqual([]);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("memory");
  expect(await moving()).toEqual([]);
  const active = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>("[data-slot=button]")!;
    return getComputedStyle(button).scale;
  });
  expect(active).toBe("none");
});

// One empty and error state, one title style, one landmark per screen: the
// cross-screen consistency the per-milestone passes could not see.
test("every screen answers a failure the same way, with one main landmark", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.test");
  const letterSpacing = (name: string) =>
    page
      .getByRole("heading", { name, exact: true })
      .evaluate((h) => getComputedStyle(h).letterSpacing);

  await page.route("**/api/usage", (route) => route.abort());
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings Are Unreachable", level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  // 22px headings track at -0.02em (-0.44px), like the 28px ones.
  expect(await letterSpacing("Settings Are Unreachable")).toBe("-0.44px");
  await page.unroute("**/api/usage");

  await page.route("**/api/admin/summary", (route) => route.abort());
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Admin Is Unreachable", level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await scan(page, "Admin unreachable");
  await page.unroute("**/api/admin/summary");

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 })
  ).toBeVisible();
  expect(await letterSpacing("Settings")).toBe("-0.56px");
});

// 2.4.1: the first Tab stop skips the sidebar; it shows only while focused.
test("Skip To Content is the first Tab stop and lands on the content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  for (const path of ["/", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("main#content")).toBeVisible();
    const skip = page.getByRole("link", { name: "Skip To Content" });
    expect(await skip.boundingBox()).toMatchObject({ y: expect.any(Number) });
    await expect(skip).not.toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#content")).toBeFocused();
    await page.keyboard.press("Tab");
    // Past the sidebar: the next stop is in the content, not the desk.
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("aside"))
    ).toBe(false);
  }
});

// The ⌘K note ("No Direct Matches", "Search Is Unreachable") is not a child of
// the listbox, and a live region outside it reads the same words once.
test("⌘K notes are read from a live region outside the listbox", async ({
  page,
}) => {
  await signIn(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("zzzz nothing like this");
  const menu = page.getByRole("dialog");
  await expect(menu.getByRole("status")).toHaveText("No Direct Matches", {
    timeout: 15_000,
  });
  await expect(menu.getByRole("listbox").getByRole("status")).toHaveCount(0);
  await scan(page, "Search menu with a note");
});

// A toast, scanned still and alone: the front one, once Sonner has settled.
for (const theme of THEMES) {
  test(`axe: the Captured toast, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    await paste(page, "A Memory for the toast");
    const toast = page.locator("[data-sonner-toast][data-front=true]");
    await expect(toast).toContainText("Captured");
    await page.waitForTimeout(600);
    await scan(page, `Captured toast, ${theme}`, { toasts: true });
  });
}
