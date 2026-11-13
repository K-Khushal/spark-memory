import { expect, test, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { signIn } from "./sign-in";

// #23: the extension's popup, Grant Access page and region overlay, at 1440
// and 390 (the popup is 320 wide in the toolbar; the wide shots are a tab).
// Build first: WXT_E2E=1 WXT_API_ORIGIN=http://localhost:5273 pnpm --filter @spark/extension build
// Then: M3_EXTENSION=1 M3_PHASE=before|after EXTENSION_E2E=1 pnpm exec playwright test
const OUT =
  process.env.M3_SCREENSHOT_DIR ??
  "/data/workspace/spark-memory/.git/factory/r";
const phase = process.env.M3_PHASE ?? "after";

test("popup, Grant Access and region overlay", async () => {
  test.setTimeout(180_000);
  test.skip(process.env.EXTENSION_E2E !== "1", "Needs the unpacked build");
  const profile = await mkdtemp(resolve(tmpdir(), "spark-m3-extension-"));
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
    const dashboard = await context.newPage();
    await signIn(dashboard);
    const fixture = await context.newPage();
    await fixture.route("https://fixture.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><title>Growing Basil</title></head><body style="font:16px system-ui;background:#fff8dc"><article><h1>Growing Basil</h1><p>${"Basil wants six hours of sunlight and warm soil. ".repeat(40)}</p></article></body></html>`,
      })
    );
    await fixture.setViewportSize({ width: 1280, height: 720 });
    await fixture.goto(`https://fixture.test/basil-${Date.now()}`);
    const popup = await context.newPage();
    const shoot = async (surface: string, page = popup) => {
      for (const colorScheme of ["light", "dark"] as const)
        for (const width of [1440, 390]) {
          await page.emulateMedia({ colorScheme });
          await page.setViewportSize({ width, height: 700 });
          await page.screenshot({
            animations: "disabled",
            path: `${OUT}/t23-${phase}-${surface}-${width}-${colorScheme}.png`,
          });
        }
    };
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await fixture.bringToFront();
    await popup.reload();
    await fixture.bringToFront();
    await expect(popup.getByRole("status")).toHaveText(
      /Saved|Already in Your Library/
    );
    await shoot("popup-saved");

    await context.setOffline(true);
    await fixture.goto(`https://fixture.test/basil-offline-${Date.now()}`);
    await popup.reload();
    await fixture.bringToFront();
    await expect(popup.getByRole("status")).toHaveText("Waiting to Send");
    await shoot("popup-queued");
    await context.setOffline(false);
    await popup.getByRole("button", { name: "Try Again" }).click();
    await expect(popup.getByRole("status")).toHaveText("Saved");

    // Keyboard only: Tab reaches every control and each shows a ring.
    await popup.setViewportSize({ width: 320, height: 500 });
    await popup.bringToFront();
    await popup.reload();
    await popup.getByRole("status").waitFor();
    for (let i = 0; i < 4; i++) {
      await popup.keyboard.press("Tab");
      const ring = await popup.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "none";
        const css = getComputedStyle(el);
        return css.outlineStyle === "none" ? "missing" : "ring";
      });
      expect(ring).not.toBe("missing");
    }

    const grantId = "permission-m3";
    await worker.evaluate(async (grantId) => {
      const chrome = (
        globalThis as unknown as {
          chrome: {
            tabs: { query(q: unknown): Promise<{ id: number }[]> };
            storage: { session: { set(value: unknown): Promise<void> } };
          };
        }
      ).chrome;
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.storage.session.set({
        permissionCapture: {
          id: grantId,
          mode: "selection",
          tabId: tab!.id,
          frameId: 0,
          origin: "https://fixture.test",
          expiresAt: Date.now() + 60_000,
        },
      });
    }, grantId);
    const permission = await context.newPage();
    await permission.goto(
      `chrome-extension://${id}/permission.html#${grantId}`
    );
    await expect(
      permission.getByRole("button", { name: "Grant Access" })
    ).toBeEnabled();
    if (phase === "after")
      await expect(
        permission.getByRole("button", { name: "Grant Access" })
      ).toBeFocused();
    await shoot("permission", permission);
    await permission.close();

    // The region overlay over a busy, yellow-ish page.
    await fixture.bringToFront();
    await fixture.setViewportSize({ width: 1280, height: 720 });
    await popup.evaluate(
      () =>
        void (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
          }
        ).chrome.runtime.sendMessage({ type: "region" })
    );
    await expect
      .poll(() =>
        fixture.evaluate(
          () =>
            !!document.documentElement.querySelector('[style*="2147483647"]')
        )
      )
      .toBe(true);
    await fixture.mouse.move(200, 160);
    await fixture.mouse.down();
    await fixture.mouse.move(640, 420, { steps: 4 });
    await fixture.screenshot({
      animations: "disabled",
      path: `${OUT}/t23-${phase}-region-1280-light.png`,
    });
    await fixture.keyboard.press("Escape");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
