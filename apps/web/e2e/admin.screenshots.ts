import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

const ADMIN = "admin@example.test";
const OUT =
  process.env.ADMIN_SCREENSHOT_DIR ?? "test-results/admin-screenshots";
const PREFIX = process.env.ADMIN_SCREENSHOT_PREFIX ?? "admin";

// Collected only when ADMIN_SCREENSHOTS=1 (`pnpm --filter @spark/web
// screenshot:admin`). `test:e2e` and GitHub Actions keep testMatch at
// `*.e2e.ts`, so this file is never part of smoke.

test("admin page at 1440 and 390, light and dark", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily Budget" })
  ).toBeVisible();

  await theme(page, "light");
  await shot(page, "1440-light", 1440, 900);
  await theme(page, "dark");
  await shot(page, "1440-dark", 1440, 900);
  await shot(page, "390-dark", 390, 844);
  await theme(page, "light");
  await shot(page, "390-light", 390, 844);
});

async function theme(page: Page, value: "light" | "dark") {
  await page.evaluate((next) => {
    localStorage.setItem("spark-theme", next);
  }, value);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Daily Budget" })
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}

async function shot(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.screenshot({
    path: `${OUT}/${PREFIX}-${name}.png`,
    fullPage: true,
  });
}
