import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("select by keyboard and mouse, set Categories, delete and Undo", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.evaluate(async () => {
    for (let n = 0; n < 8; n++)
      await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: `Bulk Memory ${n}` }),
      });
  });
  await page.reload();
  const wall = page.getByRole("list", { name: "All Memories" });
  const first = wall.getByRole("listitem").filter({ hasText: "Bulk Memory 7" });
  const second = wall
    .getByRole("listitem")
    .filter({ hasText: "Bulk Memory 6" });
  await first.focus();
  await page.keyboard.press("Space");
  const bar = page.getByRole("region", { name: "Selection", exact: true });
  await expect(bar).toContainText("1 Selected");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(bar).toContainText("2 Selected");
  await page.keyboard.press("Control+a");
  await expect(wall.locator("[data-selected]")).toHaveCount(
    await wall.getByRole("listitem").count()
  );
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await first.click({ modifiers: ["Control"] });
  await second.click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("2 Selected");
  await bar.getByRole("button", { name: "Categories", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Categories", exact: true });
  await dialog.getByRole("button", { name: "Recipe", exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/memories/bulk") && r.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Set Categories" }).click();
  await expect.poll(async () => (await saved).status()).toBe(200);
  await first.click({ modifiers: ["Control"] });
  await second.click();
  await expect(bar).toContainText("2 Selected");
  if (process.env.BULK_SCREENSHOTS_DIR) {
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({
          width,
          height: width === 1440 ? 900 : 844,
        });
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme
        );
        await page.evaluate(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          await Promise.allSettled(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getTiming().iterations !== Infinity
              )
              .map((animation) => animation.finished)
          );
        });
        await page.screenshot({
          path: `${process.env.BULK_SCREENSHOTS_DIR}/t26-${width}-${theme}.png`,
        });
      }
  }
  await bar.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(first).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).last().click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  // Marquee intersects the complete virtual layout, with one settled count announcement.
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await wall.boundingBox();
  if (!box) throw new Error("Missing wall");
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + 190, { steps: 10 });
  await page.mouse.up();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(bar).toHaveCount(0);
});
