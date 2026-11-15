import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { signIn } from "./sign-in";

test("Settings theme, chosen connection recipe and narrow layout", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
  const appearance = page.getByRole("group", { name: "Appearance" });
  await appearance.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(
    appearance.getByRole("button", { name: "Dark", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByRole("switch", { name: "Import All Today" })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Connection Guide" }).click();
  const dialog = page.getByRole("dialog", { name: "Connection Guide" });
  await expect(
    dialog.getByRole("heading", { name: "Claude Code", exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Codex", exact: true })
  ).toHaveCount(0);
  await dialog.getByLabel("Assistant", { exact: true }).selectOption("Codex");
  await expect(
    dialog.getByRole("heading", { name: "Claude Code", exact: true })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Copy codex mcp add", exact: true })
  ).toBeVisible();
  const out = process.env.UI_D_OUT;
  if (out) await mkdir(out, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const done = dialog.getByRole("button", { name: "Done", exact: true });
      await expect(done).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished)
        );
      });
      if (out)
        await page.screenshot({
          path: `${out}/d-guide-${theme}-${width}-200.png`,
          animations: "disabled",
        });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Connection Guide" })
  ).toBeFocused();
  const deletion = page.getByRole("button", {
    name: "Delete Account",
    exact: true,
  });
  await deletion.click();
  await expect(
    page.getByRole("dialog", { name: "Delete Your Account and Every Memory" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deletion).toBeFocused();
});

test("Admin tables and Settings remain reachable at 200% text", async ({
  page,
}) => {
  await signIn(page, "admin@example.test");
  const out = process.env.UI_D_OUT;
  if (out) await mkdir(out, { recursive: true });
  for (const path of ["/admin", "/settings"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: path === "/admin" ? "Daily Spend" : "Usage",
        exact: true,
      })
    ).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.fontSize = "200%";
      }, theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        if (path === "/admin") {
          const table = page.getByRole("region", {
            name: "Usage",
            exact: true,
          });
          await table.focus();
          await expect(table).toBeFocused();
          await page.keyboard.press("End");
        }
        if (out)
          await page.screenshot({
            path: `${out}/d-${path.slice(1)}-${theme}-${width}-200.png`,
            fullPage: true,
            animations: "disabled",
          });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  }
});
