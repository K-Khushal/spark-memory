import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

const longName = "ProductInfrastructureDesignReferences2026";
const categories = Array.from({ length: 50 }, (_, i) => ({
  id: `category-${i}`,
  name:
    [longName, "وصفات الجدة", "दादी की रेसिपी 🌿", "J"][i] ??
    `Category ${i + 1}`,
  memories: i,
}));

async function fixtures(page: Page) {
  await page.evaluate(() =>
    fetch("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "A Memory for the polish review" }),
    })
  );
  await page.route("**/api/categories", (route) =>
    route.fulfill({ json: { categories } })
  );
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
            title: longName,
            sourceUrl: null,
            bytes: 25_000_000,
          },
        ],
      },
    })
  );
  await page.route("**/api/account/sessions", (route) =>
    route.fulfill({
      json: {
        sessions: [
          {
            handle: "current",
            device: longName,
            current: true,
            lastActiveAt: new Date().toISOString(),
          },
        ],
      },
    })
  );
  await page.route("**/api/account/export", (route) =>
    route.fulfill({
      json: {
        export: {
          state: "ready",
          requestedAt: "2026-11-01T00:00:00Z",
          expiresAt: "2026-12-01T00:00:00Z",
          nextExportAt: "2026-11-01T01:00:00Z",
          bytes: 100,
        },
      },
    })
  );
  await page.route("**/api/assistants", (route) =>
    route.fulfill({
      json: {
        assistants: [
          { id: "assistant", name: longName.repeat(2), lastActiveAt: null },
        ],
      },
    })
  );
  await page.route("**/api/imports/latest", (route) =>
    route.fulfill({
      json: {
        job: {
          id: "large-import",
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
}

const phase = process.env.T33_SCREENSHOTS;
async function shot(page: Page, name: string) {
  if (!phase) return;
  await page.screenshot({
    path: `/data/workspace/spark-memory/.git/factory/r/t33-${phase}-${name}.png`,
    fullPage: true,
  });
}
async function fits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);
}

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`M4/M5 stress surfaces ${width} ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page);
      await fixtures(page);
      await page.goto("/settings");
      await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
      await expect(
        page.getByText("1,284 of 10,000 Imported, 1 Skipped", { exact: true })
      ).toBeVisible();
      await shot(page, `settings-${width}-${theme}`);
      await fits(page);
      await page
        .getByRole("button", { name: "Connection Guide", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Connection Guide" })
      ).toBeVisible();
      await fits(page);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Delete Account", exact: true })
        .click();
      await shot(page, `account-${width}-${theme}`);
      await fits(page);
      await page.keyboard.press("Escape");
      await page.goto("/");
      await page
        .getByRole("button", { name: "Manage Categories" })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Categories",
        exact: true,
      });
      await expect(dialog.getByRole("listitem")).toHaveCount(50);
      await shot(page, `categories-${width}-${theme}`);
      await fits(page);
      // Every row remains reachable by keyboard, including the final delete.
      const last = dialog.getByRole("button", {
        name: "Delete Category 50",
        exact: true,
      });
      await last.focus();
      await expect(last).toBeInViewport();
      await page.keyboard.press("Escape");
      await page
        .getByRole("list", { name: "All Memories", exact: true })
        .getByRole("listitem")
        .first()
        .dblclick();
      await page.locator("summary").click();
      await shot(page, `category-editor-${width}-${theme}`);
      await page.keyboard.press("Escape");
      await page.goto("/prototypes?selection");
      await page
        .getByRole("button", { name: "Worst Case", exact: true })
        .click();
      await page
        .getByRole("list", { name: "Selection Memories" })
        .getByRole("listitem")
        .first()
        .focus();
      await page.keyboard.press("Control+a");
      const bar = page.getByRole("region", { name: "Selection", exact: true });
      await expect(bar).toContainText("8 Selected");
      await shot(page, `selection-${width}-${theme}`);
      await bar
        .getByRole("button", { name: "Categories", exact: true })
        .click();
      await shot(page, `bulk-categories-${width}-${theme}`);
      await fits(page);
      await page.goto("/offline.html");
      await shot(page, `offline-${width}-${theme}`);
    });
  }
}

test("Settings and Categories at 320px with 200% text and RTL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page);
  await fixtures(page);
  await page.goto("/settings");
  await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dir = "rtl";
  });
  await fits(page);
  // A keyboard-only pass exposes clipped focus and controls behind scroll edges.
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body)
        return { valid: true };
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        valid:
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          style.outlineStyle !== "none",
        name: el.getAttribute("aria-label") ?? el.textContent,
        left: rect.left,
        right: rect.right,
        outline: style.outlineStyle,
      };
    });
    expect(focused.valid, JSON.stringify(focused)).toBe(true);
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Manage Categories" })
    .filter({ visible: true })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dir = "rtl";
  });
  await fits(page);
  const dialog = page.getByRole("dialog", { name: "Categories", exact: true });
  await dialog
    .getByRole("button", { name: `Rename ${longName}`, exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: `New Name for ${longName}` })
  ).toBeVisible();
  await fits(page);
});

test("Share confirmation keeps the entire shared text reachable", async ({
  page,
}) => {
  await signIn(page);
  const text = Array.from(
    { length: 40 },
    (_, i) => `Shared Recipe Step ${i + 1}: Mix The Ingredients 🌿`
  ).join("\n");
  await page.evaluate(
    (text) =>
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
            text,
            url: "",
            files: [],
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    text
  );
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Capture This Share?" });
  await expect(dialog).toBeVisible();
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await shot(page, `share-${width}-${theme}`);
    }
  }
  if (phase !== "before") {
    const preview = dialog.getByRole("region", { name: "Shared Text" });
    await preview.focus();
    await page.keyboard.press("Control+End");
    await expect(preview).toContainText("Shared Recipe Step 40");
    await expect(preview).toBeFocused();
    expect(await preview.evaluate((el) => el.scrollTop > 0)).toBe(true);
  }
  await dialog.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toBeHidden();
});
