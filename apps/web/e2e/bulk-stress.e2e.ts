import { expect, test } from "@playwright/test";

test("selection survives long text, narrow screens, reduced motion and virtualisation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes?selection");
  const nav = page.getByRole("navigation", { name: "Demo Data" });
  await nav.getByRole("button", { name: "Worst Case", exact: true }).click();
  const wall = page.getByRole("list", { name: "Selection Memories" });
  await wall.getByRole("listitem").first().focus();
  await page.keyboard.press("Control+a");
  const bar = page.getByRole("region", { name: "Selection", exact: true });
  await expect(bar).toContainText("8 Selected");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      bar.getByRole("button", { name: "Clear", exact: true })
    ).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true);
    await bar.getByRole("button", { name: "Categories", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Categories",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", {
        name: "An Unreasonably Long Category Name Here",
      })
    ).toBeVisible();
    for (const category of ["Recipe", "Code", "Article"])
      await dialog.getByRole("button", { name: category, exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Video", exact: true })
    ).toBeDisabled();
    await page.keyboard.press("Escape");
  }
  await nav.getByRole("button", { name: "10,000 Rows", exact: true }).click();
  await wall.getByRole("listitem").first().focus();
  await page.keyboard.press("Control+a");
  await expect(bar).toContainText("10,000 Selected");
  expect(await wall.getByRole("listitem").count()).toBeLessThan(100);
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await nav.getByRole("button", { name: "Empty", exact: true }).click();
  await expect(wall.getByRole("listitem")).toHaveCount(0);
  await nav.getByRole("button", { name: "One", exact: true }).click();
  await wall.getByRole("listitem").first().focus();
  await page.keyboard.press("Space");
  await expect(bar).toContainText("1 Selected");
  await wall
    .getByRole("button", { name: "Select Memory 1", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("touch long-press enters selection, then tapping toggles", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/prototypes?selection");
    const wall = page.getByRole("list", { name: "Selection Memories" });
    const first = wall.getByRole("listitem").first();
    await first.dispatchEvent("pointerdown", {
      pointerType: "touch",
      button: 0,
      clientX: 50,
      clientY: 180,
    });
    const bar = page.getByRole("region", { name: "Selection", exact: true });
    await expect(bar).toContainText("1 Selected");
    await first.dispatchEvent("pointerup", { pointerType: "touch", button: 0 });
    // The synthetic click generated after the hold is suppressed.
    await first.dispatchEvent("click");
    await expect(bar).toContainText("1 Selected");
    await wall.getByRole("listitem").nth(1).tap();
    await expect(bar).toContainText("2 Selected");
  } finally {
    await context.close();
  }
});
