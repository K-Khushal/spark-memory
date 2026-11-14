import { expect, test } from "@playwright/test";
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
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Connection Guide" })
  ).toBeFocused();
});
