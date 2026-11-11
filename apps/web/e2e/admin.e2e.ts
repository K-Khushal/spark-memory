import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

const ADMIN = "admin@example.test";
const SHOTS = "/data/workspace/spark-memory/.git/factory/r";

test("a person who is not an admin never sees the admin page", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
});

test("an admin sees spend and usage, and can change the daily budget", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await signIn(page, ADMIN);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Admin smoke memory");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  });
  await expect(page.getByText("Captured")).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "Admin smoke memory", exact: true })
  ).toBeVisible({ timeout: 15_000 });
  // The Capture toast belongs to the Library. Let it leave before the shots.
  await expect(page.getByText("Captured")).toBeHidden({ timeout: 10_000 });

  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daily Budget" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daily Spend" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  await expect(page.getByText("Active")).toBeVisible();
  await expect(page.getByRole("cell", { name: ADMIN })).toBeVisible();

  await theme(page, "light");
  await shot(page, "1440-light", 1440, 900);
  await theme(page, "dark");
  await shot(page, "1440-dark", 1440, 900);
  await shot(page, "390-dark", 390, 844);
  await theme(page, "light");
  await shot(page, "390-light", 390, 844);

  const budget = page.getByRole("textbox", { name: "Daily Budget" });
  await budget.fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/\/ \$2\.00/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/\/ \$2\.00/)).toBeVisible();

  await budget.fill("1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/\/ \$1\.00/)).toBeVisible();
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
    path: `${SHOTS}/t32-admin-${name}.png`,
    fullPage: true,
  });
}
