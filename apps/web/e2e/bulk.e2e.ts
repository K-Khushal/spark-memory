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
  expect((await saved).status()).toBe(200);
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

test("Shift+arrows extend the shared selection across Direct and Related Matches", async ({
  page,
}) => {
  await signIn(page);
  const ids = await page.evaluate(async () => {
    const ids: string[] = [];
    for (const body of ["Boundary Direct", "Boundary Related"]) {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      ids.push((await response.json()).id);
    }
    return ids;
  });
  await page.reload();
  await page.route("**/api/search", (route) =>
    route.fulfill({
      json: {
        mode: "full",
        results: ids.map((id, i) => ({
          id,
          match: i ? "related" : "direct",
          part: null,
        })),
      },
    })
  );
  await expect(
    page.getByRole("listitem", { name: "Boundary Direct", exact: true })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("Boundary");
  await expect(
    page.getByRole("option", { name: "Boundary Direct" })
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const direct = page
    .getByRole("list", { name: "Direct Matches" })
    .getByRole("listitem");
  const related = page
    .getByRole("list", { name: "Related Matches" })
    .getByRole("listitem");
  const bar = page.getByRole("region", { name: "Selection", exact: true });
  await direct.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(related).toBeFocused();
  await expect(bar).toContainText("2 Selected");
  await page.keyboard.press("Escape");
  await related.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(direct).toBeFocused();
  await expect(bar).toContainText("2 Selected");
});

test("replays an unacknowledged bulk delete from IndexedDB after reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.evaluate(async () => {
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Durable Bulk Memory" }),
    });
  });
  await page.reload();
  const tile = page.getByRole("listitem", {
    name: "Durable Bulk Memory",
    exact: true,
  });
  await tile.focus();
  await page.keyboard.press("Space");
  await page.route("**/api/memories/bulk", (route) => route.abort());
  await page
    .getByRole("region", { name: "Selection", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByText("1 Memory Not Updated", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/api/memories/bulk");
  const replay = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/memories/bulk") && r.request().method() === "POST"
  );
  await page.reload();
  expect((await replay).status()).toBe(200);
  await expect(tile).toHaveCount(0);
  await page.reload();
  await expect(tile).toHaveCount(0);
});
