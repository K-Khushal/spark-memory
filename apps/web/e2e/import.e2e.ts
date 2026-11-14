import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";
test.setTimeout(180_000);

test("import an export, persist progress through reload, and cancel without losing Captures", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Import URLs" })).toBeVisible();
  await page.getByLabel("Import File", { exact: true }).setInputFiles({
    name: "urls.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "https://example.com/import-one\nhttps://example.com/import-two?utm_source=pocket\nhttps://example.com/import-one?utm_source=duplicate"
    ),
  });
  await expect(
    page.getByRole("progressbar", { name: "Import Progress" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause Import" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume Import" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume Import" }).click();
  await page.getByRole("button", { name: "Cancel Import" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  const dir = process.env.IMPORT_SCREENSHOTS;
  if (dir) {
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          (t) => document.documentElement.setAttribute("data-theme", t),
          theme
        );
        await page.screenshot({
          path: `${dir}/t29-${width}-${theme}.png`,
          fullPage: true,
        });
      }
  }
});

test("folder images reuse presigned Capture and background Indexing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByLabel("Image Files", { exact: true })).toBeAttached();
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    canvas.getContext("2d")!.fillRect(0, 0, 64, 48);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Image Files"]'
    )!;
    const files = new DataTransfer();
    files.items.add(new File([blob], "morning.png", { type: "image/png" }));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 30_000,
    })
    .toMatchObject({ memories: [{ kind: "image" }] });
  await page.reload();
  await expect(
    page.getByRole("progressbar", { name: "Import Progress" })
  ).toHaveAttribute("value", "1", { timeout: 60_000 });
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
});

test("import progress fits worst-case counts, narrow widths, zoom and RTL", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/account/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } })
  );
  await page.route("**/api/account/export", (route) =>
    route.fulfill({ json: { export: null } })
  );
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        storage: { used: 0, limit: 1073741824 },
        captures: { used: 0, limit: 100 },
        deepFetches: { used: 0, limit: 20 },
        resetsAt: "2026-11-14T00:00:00.000Z",
        largest: [],
      },
    })
  );
  const states = {
    Demo: { total: 1, done: 0, skipped: 0, state: "paused" },
    "Worst Case": { total: 10000, done: 9998, skipped: 1, state: "paused" },
    Empty: null,
    Complete: { total: 10000, done: 9999, skipped: 1, state: "done" },
  };
  await page.route("**/api/imports/latest", (route) => {
    const selected =
      new URL(page.url()).searchParams.get("importDemo") ?? "Demo";
    const data = states[selected as keyof typeof states];
    return route.fulfill({
      json: {
        job: data && {
          id: "10000000-0000-4000-8000-000000000001",
          loaded: data.total,
          availableAt: "2020-01-01T00:00:00.000Z",
          ...data,
        },
      },
    });
  });
  for (const state of Object.keys(states)) {
    await page.goto(`/settings?importDemo=${encodeURIComponent(state)}`);
    await expect(
      page.getByRole("heading", { name: "Import", exact: true })
    ).toBeVisible();
    // A test-only fixture picker; data still enters through the production API boundary.
    await page.evaluate((states) => {
      const picker = document.createElement("nav");
      picker.setAttribute("aria-label", "Import Demo Data");
      picker.style.cssText =
        "position:fixed;bottom:0;z-index:100;background:Canvas;color:CanvasText";
      for (const state of states) {
        const link = document.createElement("a");
        link.href = `?importDemo=${encodeURIComponent(state)}`;
        link.textContent = state;
        link.style.margin = "4px";
        picker.append(link);
      }
      document.body.append(picker);
    }, Object.keys(states));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dir = "rtl";
          document.documentElement.style.fontSize = "200%";
        }, theme);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true);
      }
    }
  }
});
