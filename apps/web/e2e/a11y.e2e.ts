import AxeBuilder from "@axe-core/playwright";
import { chromium, expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { signIn } from "./sign-in";

// WCAG 2.2 AA, scanned by axe on every screen and state in both themes. A new
// violation fails this file, so the app cannot regress without a person
// choosing to. Contrast is checked by axe in the rendered colours.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Waits for fades and slides to finish: axe reads colour mid-fade as low contrast. */
async function settle(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          // A spinner never finishes; only fades and slides are waited for.
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined))
      )
    );
  }
}

async function scan(page: Page, label: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Radix portals mark the page behind a dialog inert; axe still reads it.
    .analyze();
  expect
    .soft(
      violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
      })),
      label
    )
    .toEqual([]);
}

/** ⌘V outside a text field, with `text` on the clipboard. */
async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

/** Drops a real small PNG on the page, as a person dragging it in would. */
async function dropImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fe0";
    context.fillRect(0, 0, 64, 48);
    context.fillStyle = "#ffe15a";
    context.fillRect(8, 8, 24, 24);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([png], "square.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      window.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true })
      );
    }
  });
}

/** A small real one-page PDF (Helvetica, uncompressed). */
function pdfOf(text: string) {
  const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

async function dropPdf(page: Page, text: string) {
  await page.evaluate(
    ({ text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], "scan.pdf", { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        window.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true })
        );
      }
    },
    { text: pdfOf(text) }
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`axe: signed-out screens, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/sign-in");
    await expect(
      page.getByRole("button", { name: "Continue with Email" })
    ).toBeVisible();
    await scan(page, "sign-in");
    await page.getByPlaceholder("Email").fill("axe@example.com");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(
      page.getByRole("heading", { name: "Check Your Email" })
    ).toBeVisible();
    await scan(page, "sign-in code step");
    await page.goto("/offline.html");
    await scan(page, "offline");
  });

  test(`axe: Library, search and Memory detail, ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    // A new Library: Get Started, samples.
    await scan(page, "new Library with Get Started");

    await paste(page, "Lemon tart with a salted shortcrust, from Grandma");
    await paste(page, "# Packing list\nPassport\nCharger\nSunscreen");
    await paste(page, "https://example.com/?utm_source=axe");
    await dropImage(page);
    await dropPdf(page, "Quarterly report on lemon tarts");
    const wall = page.getByRole("list", { name: "All Memories" });
    await expect(wall.getByRole("listitem")).not.toHaveCount(0);
    await expect(
      wall.getByRole("listitem", { name: /Lemon tart/ })
    ).toBeVisible();
    await expect(wall.locator("img").first()).toBeVisible();
    await scan(page, "Library wall");

    // Capture dialog
    await page
      .getByRole("button", { name: "Capture", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "Capture dialog");
    await page.keyboard.press("Escape");

    // Search: menu, then results on the wall.
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("lemon");
    await expect(
      page.getByRole("option", { name: /Lemon tart/ })
    ).toBeVisible();
    await scan(page, "Search menu with instant results");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("list", { name: "Direct Matches" })
    ).toBeVisible();
    await scan(page, "Search results on the wall");
    await page.getByRole("button", { name: "Clear Search" }).click();

    // Memory detail
    await wall.getByRole("listitem", { name: /Lemon tart/ }).dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "Memory detail");
    await page.keyboard.press("Escape");

    // Categories manager
    await page
      .getByRole("button", { name: "Manage Categories" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Categories", exact: true })
    ).toBeVisible();
    await scan(page, "Categories manager");
    await page.keyboard.press("Escape");

    // Bulk selection
    await wall.getByRole("listitem").first().focus();
    await page.keyboard.press("Control+a");
    await expect(
      page.getByRole("region", { name: "Selection", exact: true })
    ).toBeVisible();
    await scan(page, "Bulk selection bar");
    await page.keyboard.press("Escape");

    // Image viewer
    await wall.locator("img").first().dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "Image viewer");
    await page.keyboard.press("Escape");

    // The PDF opens in its own viewer.
    await wall.getByRole("listitem", { name: /scan|Quarterly/ }).dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "PDF viewer");
    await page.keyboard.press("Escape");

    // A link opens as a reader.
    await wall
      .getByRole("listitem", { name: /Example Domain|example\.com/ })
      .dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "Link reader");
    await page.keyboard.press("Escape");

    // Category picker for a selection.
    await wall.getByRole("listitem").first().focus();
    await page.keyboard.press("Control+a");
    await page
      .getByRole("region", { name: "Selection", exact: true })
      .getByRole("button", { name: "Categories", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "Bulk Categories picker");
    await page.keyboard.press("Escape");

    // A search with no Direct Matches shows filter chips over Related ones.
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("zzzz nothing like this");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: /No Direct Matches/ })
    ).toBeVisible({ timeout: 15_000 });
    await scan(page, "Search with no Direct Matches");
  });

  test(`axe: Settings, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
    await scan(page, "Settings");
    await page
      .getByRole("button", { name: "Connection Guide", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Connection Guide" })
    ).toBeVisible();
    await scan(page, "Connection Guide");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Delete Account", exact: true })
      .click();
    await scan(page, "Delete Account confirmation");
  });

  test(`axe: Admin, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, "admin@example.test");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /Admin/ })).toBeVisible();
    await scan(page, "Admin");
  });
}

test("axe: the share confirmation", async ({ page }) => {
  await signIn(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("spark-share", 2);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("pending", { autoIncrement: true });
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
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(
      page.getByRole("dialog", { name: "Capture This Share?" })
    ).toBeVisible();
    await scan(page, `share confirmation, ${theme}`);
  }
});

test("axe: Settings at its limits", async ({ page }) => {
  await signIn(page);
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
        assistants: [{ id: "a", name: "Claude Desktop", lastActiveAt: null }],
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
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/settings");
    await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
    await scan(page, `Settings with full meters and a paused import, ${theme}`);
  }
});

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

test("axe: the phone layout", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  await paste(page, "Lemon tart with a salted shortcrust, from Grandma");
  await expect(
    page.getByRole("list", { name: "All Memories" }).getByRole("listitem")
  ).not.toHaveCount(0);
  await scan(page, "Library on a phone");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await scan(page, "Settings on a phone");
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

// 2.4.11: a focused tile is never hidden under the phone's sticky bar, and
// arrow keys scroll it into view even with the Get Started band above.
test("arrow keys keep the focused tile clear of the sticky phone bar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 700 });
  await signIn(page);
  await page.evaluate(async () => {
    for (let i = 0; i < 24; i++)
      await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: `Memory ${i} about lemon tarts and travel plans `.repeat(
            1 + (i % 4)
          ),
        }),
      });
  });
  await page.reload();
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall.getByRole("listitem").first()).toBeVisible();
  await wall.getByRole("listitem").first().focus();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            const box = el.getBoundingClientRect();
            const bar = document
              .querySelector("main > .sticky")!
              .getBoundingClientRect();
            return box.top >= bar.bottom - 1 && box.bottom <= innerHeight + 1;
          }),
        { message: `after ArrowDown ${i + 1}` }
      )
      .toBe(true);
  }
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
