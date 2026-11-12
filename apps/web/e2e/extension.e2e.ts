import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { signIn } from "./sign-in";

// Build with WXT_API_ORIGIN=http://localhost:5173 before this test.
test("unpacked extension shares sign-in and captures a fixture page", async () => {
  test.setTimeout(90_000);
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
        body: `<html><head><title>Growing Basil</title><meta property="og:description" content="A garden guide"></head><body><article><h1>Growing Basil</h1><p>${"Basil wants six hours of sunlight and warm soil. ".repeat(30)}</p></article><div style="height:1200px"></div><p>Basil grows best near the south window in spring. Keep the soil moist.</p></body></html>`,
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
    await expect(
      popup.getByRole("button", { name: "Discard Outbox" })
    ).toHaveCount(0);
    const fonts = await popup.evaluate(async () =>
      Promise.all([
        document.fonts.load('400 13px "Instrument Sans Variable"'),
        document.fonts.load('600 13px "Bricolage Grotesque Variable"'),
      ]).then((families) =>
        families.map(
          (faces) =>
            faces.length > 0 && faces.every((face) => face.status === "loaded")
        )
      )
    );
    expect(fonts).toEqual([true, true]);
    await fixture.goto(`${fixtureUrl}-offline`);
    await context.setOffline(true);
    await popup.reload();
    await fixture.bringToFront();
    await expect(popup.getByRole("status")).toHaveText("Waiting to Send");
    await expect(
      popup.getByRole("button", { name: "Discard Outbox" })
    ).toBeVisible();
    await popup.getByRole("button", { name: "Try Again" }).click();
    await expect(popup.getByRole("status")).toHaveText("Waiting to Send");
    await context.setOffline(false);
    await popup.getByRole("button", { name: "Try Again" }).click();
    await expect(popup.getByRole("status")).toHaveText("Saved");
    await expect(
      popup.getByRole("button", { name: "Discard Outbox" })
    ).toHaveCount(0);
    await fixture.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("body > p")!.firstChild!);
      range.setEnd(document.querySelector("body > p")!.firstChild!, 48);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    const selection = await popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage({ type: "selection" })
    );
    expect(selection).toMatchObject({ state: "saved" });
    const selectionData = await (
      await dashboard.request.get("/api/memories")
    ).json();
    expect(
      selectionData.memories.find(
        (m: { kind: string; sourceUrl?: string }) =>
          m.kind === "text" && m.sourceUrl?.includes("#:~:text=")
      )
    ).toMatchObject({ body: expect.stringContaining("Basil") });

    const textMemory = selectionData.memories.find(
      (m: { kind: string; sourceUrl?: string }) =>
        m.kind === "text" && m.sourceUrl?.includes("#:~:text=")
    );
    await fixture.goto(textMemory.sourceUrl);
    await expect
      .poll(() => fixture.evaluate(() => scrollY))
      .toBeGreaterThan(500);
    await fixture.evaluate(() => scrollTo(0, 0));

    // Direct manipulation, cancellation, then real crop + upload through R2.
    const cancelled = popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage({ type: "region" })
    );
    await fixture.waitForFunction(() =>
      [...document.documentElement.children].some(
        (el) => (el as HTMLElement).style.zIndex === "2147483647"
      )
    );
    await fixture.keyboard.press("Escape");
    expect(await cancelled).toMatchObject({ label: "Cancelled" });
    const keyboardCancel = popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage({ type: "region" })
    );
    await fixture.waitForFunction(() =>
      [...document.documentElement.children].some(
        (el) => (el as HTMLElement).style.zIndex === "2147483647"
      )
    );
    await fixture.keyboard.press("ArrowRight");
    await fixture.mouse.click(1200, 35);
    expect(await keyboardCancel).toMatchObject({ label: "Cancelled" });

    const region = popup.evaluate(() =>
      (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage({ type: "region" })
    );
    await fixture.waitForFunction(() =>
      [...document.documentElement.children].some(
        (el) => (el as HTMLElement).style.zIndex === "2147483647"
      )
    );
    await fixture.mouse.move(40, 100);
    await fixture.mouse.down();
    await fixture.mouse.move(240, 240, { steps: 8 });
    await fixture.mouse.up();
    expect(await region).toMatchObject({ state: "saved" });
    const images = await (await dashboard.request.get("/api/memories")).json();
    expect(
      images.memories.some(
        (m: { kind: string; preservation: string }) =>
          m.kind === "image" && m.preservation === "preserved"
      )
    ).toBe(true);
    const folder =
      process.env.EXTENSION_SCREENSHOTS_DIR ?? test.info().outputPath("popup");
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
          path: `${folder}/t18-${width}-${colorScheme}.png`,
        });
        await fixture.emulateMedia({ colorScheme });
        await fixture.setViewportSize({ width, height: 700 });
        await fixture.bringToFront();
        const overlay = popup.evaluate(() =>
          (
            globalThis as unknown as {
              chrome: {
                runtime: { sendMessage(m: unknown): Promise<unknown> };
              };
            }
          ).chrome.runtime.sendMessage({ type: "region" })
        );
        await fixture.waitForFunction(() =>
          [...document.documentElement.children].some(
            (el) => (el as HTMLElement).style.zIndex === "2147483647"
          )
        );
        await fixture.keyboard.press("ArrowRight");
        await fixture.screenshot({
          path: `${folder}/t18-region-${width}-${colorScheme}.png`,
        });
        await fixture.keyboard.press("Escape");
        expect(await overlay).toMatchObject({ label: "Cancelled" });
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
    await popup.screenshot({ path: `${folder}/t18-320-dark-worst.png` });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
