import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

const ADMIN = "admin@example.test";

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
  // The Capture toast belongs to the Library. Let it leave before leaving the page.
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
  const usage = page.getByRole("table", { name: "Usage" });
  await expect(
    usage.getByRole("columnheader", { name: "Email" })
  ).toBeVisible();
  await expect(usage.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText("Active")).toBeVisible();
  // Usage is paginated (50, dearest first). A database that already holds
  // many people may not put this admin on page 1, so the smoke does not
  // look for a particular row.

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
