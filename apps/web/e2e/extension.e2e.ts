import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { signIn } from "./sign-in";

// Build with WXT_API_ORIGIN=http://localhost:5173 before this test.
test("unpacked extension shares sign-in and captures a fixture page", async () => {
  test.skip(
    process.env.EXTENSION_E2E !== "1",
    "Requires the local unpacked test build"
  );
  const profile = await mkdtemp(resolve(tmpdir(), "spark-extension-"));
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
    const fixtureUrl = `https://fixture.test/basil-${Date.now()}`;
    await fixture.route("https://fixture.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><title>Growing Basil</title><meta property="og:description" content="A garden guide"></head><body><article><h1>Growing Basil</h1><p>${"Basil wants six hours of sunlight and warm soil. ".repeat(30)}</p></article></body></html>`,
      })
    );
    await fixture.goto(fixtureUrl);
    // A tab opened by automation cannot grant activeTab. Use a host grant only
    // in this test build; production has only activeTab for extraction.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await fixture.bringToFront();
    const result = await popup.evaluate(async () => {
      // Popup's own boot Capture can see itself; the explicit second request
      // happens with the fixture focused and after that first result settles.
      await new Promise((resolve) => setTimeout(resolve, 800));
      return await (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown): Promise<unknown> };
          };
        }
      ).chrome.runtime.sendMessage({ type: "capture" });
    });
    expect(result).toMatchObject({
      state: expect.stringMatching(/saved|duplicate/),
    });
    await popup.reload();
    await fixture.bringToFront();
    await expect(popup.getByRole("status")).toHaveText(
      /Saved|Already in Your Library/
    );
    await popup.getByLabel("Capture Note").fill("For the windowsill");
    await popup.getByRole("button", { name: "Add Capture Note" }).click();
    await expect(
      popup.getByRole("button", { name: "Saved", exact: true })
    ).toBeVisible();
    const library = await dashboard.request.get("/api/memories");
    const data = await library.json();
    const memory = data.memories.find(
      (m: { sourceUrl: string }) => m.sourceUrl === fixtureUrl
    );
    expect(memory).toMatchObject({
      pageTitle: "Growing Basil",
      preservation: "preserved",
      captureNote: "For the windowsill",
    });
    expect(memory.body).toContain("six hours of sunlight");
    const screenshot = await dashboard.request.get(
      `/api/memories/${memory.id}/screenshot`
    );
    expect(screenshot.ok()).toBe(true);
    await fixture.goto(`${fixtureUrl}-offline`);
    await context.setOffline(true);
    await fixture.bringToFront();
    const queued = await popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown): Promise<unknown> };
          };
        }
      ).chrome.runtime.sendMessage({ type: "capture" })
    );
    expect(queued).toMatchObject({ state: "queued" });
    await context.setOffline(false);
    const retried = await popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown): Promise<unknown> };
          };
        }
      ).chrome.runtime.sendMessage({ type: "retry" })
    );
    expect(retried).toMatchObject({ state: "saved" });
    const folder = "/data/workspace/spark-memory/.git/factory/r";
    await mkdir(folder, { recursive: true });
    for (const colorScheme of ["light", "dark"] as const)
      for (const width of [1440, 390]) {
        await popup.emulateMedia({ colorScheme });
        await popup.reload();
        await fixture.bringToFront();
        await expect(popup.getByRole("status")).toHaveText(
          /Saved|Already in Your Library/
        );
        await popup.setViewportSize({ width, height: 700 });
        await popup.screenshot({
          path: `${folder}/t17-${width}-${colorScheme}.png`,
        });
      }
    await popup.setViewportSize({ width: 320, height: 900 });
    await popup
      .getByLabel("Capture Note")
      .fill("نور الهدى 王秀英 🦊 ".repeat(50).slice(0, 500));
    await popup.evaluate(() => {
      document.body.dir = "rtl";
      document.documentElement.style.fontSize = "26px";
    });
    expect(
      await popup.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await popup.getByRole("button", { name: "Add Capture Note" }).focus();
    await popup.screenshot({ path: `${folder}/t17-320-dark-worst.png` });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
