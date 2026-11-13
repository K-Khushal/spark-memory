import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

test("make, use, rename and delete a Category of your own", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const tile = page.getByRole("listitem", { name: /Sourdough starter/ });
  await paste(page, "Sourdough starter notes");
  await expect(tile).toBeVisible();

  // Make one, from the keyboard; a name that is not Title Case is refused.
  const sidebar = page.getByRole("list", { name: "Category" });
  await sidebar.getByRole("button", { name: "Manage Categories" }).focus();
  await page.keyboard.press("Enter");
  const manage = page.getByRole("dialog", { name: "Categories" });
  const name = manage.getByLabel("Category Name");
  await expect(name).toBeFocused();
  await name.fill("baking");
  await expect(manage.getByRole("alert")).toHaveText("Use Title Case");
  await expect(manage.getByRole("button", { name: "Add" })).toBeDisabled();
  await name.fill("Baking");
  await page.keyboard.press("Enter");
  const own = manage.getByRole("list", { name: "Your Categories" });
  await expect(own.getByText("Baking")).toBeVisible();
  // Not twice, in any case.
  await name.fill("BAKING");
  await expect(manage.getByRole("alert")).toHaveText("Already Exists");
  await page.keyboard.press("Escape");
  await expect(manage).toBeHidden();
  const baking = sidebar.getByRole("button", { name: "Baking", exact: true });
  await expect(baking).toBeVisible();

  // Give a Memory the Category, and filter by it.
  await tile.click();
  const detail = page.getByRole("dialog");
  await detail.locator("summary").click();
  await detail.getByRole("button", { name: "Baking", exact: true }).click();
  await detail.getByRole("button", { name: "Other", exact: true }).click();
  await detail.getByRole("button", { name: "Apply" }).click();
  await expect(detail.locator("summary")).toHaveText("Baking");
  await page.keyboard.press("Escape");
  await baking.click();
  await expect(tile).toBeVisible();

  // Rename it: the filter and the Memory follow.
  await sidebar.getByRole("button", { name: "Manage Categories" }).click();
  await own.getByRole("button", { name: "Rename Baking" }).click();
  await manage.getByLabel("New Name for Baking").fill("Bakes");
  await page.keyboard.press("Enter");
  await expect(own.getByText("Bakes", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    sidebar.getByRole("button", { name: "Bakes", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(tile).toBeVisible();

  // Delete it: the confirmation names it and says how many Memories lose it.
  await sidebar.getByRole("button", { name: "Manage Categories" }).click();
  await own.getByRole("button", { name: "Delete Bakes" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete Bakes" });
  await expect(confirm).toContainText("1 Memory loses it");
  await confirm.getByRole("button", { name: "Delete Category" }).click();
  await expect(confirm).toBeHidden();
  await expect(own).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    sidebar.getByRole("button", { name: "Bakes", exact: true })
  ).toHaveCount(0);
  // The Memory is still there, in Other; the filter on the deleted Category is gone.
  await expect(tile).toBeVisible();
  await sidebar.getByRole("button", { name: "Other", exact: true }).click();
  await expect(tile).toBeVisible();
});
