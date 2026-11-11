import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("see this device, export the Library, delete the account", async ({
  page,
}) => {
  const email = await signIn(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const sessions = page.getByRole("list", { name: "Sessions" });
  await expect(sessions.getByText("This Device")).toBeVisible();
  await expect(sessions.getByRole("listitem")).toHaveCount(1);

  // The export builds in the background (the local account queue), then
  // downloads as a ZIP.
  await page.getByRole("button", { name: "Export Library" }).click();
  const download = page.getByRole("link", { name: "Download" });
  await expect(download).toBeVisible({ timeout: 15_000 });
  const res = await page.request.get((await download.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/\.zip"$/);
  expect((await res.body()).subarray(0, 2).toString()).toBe("PK");

  // Deleting needs the address typed.
  await page.getByRole("button", { name: "Delete Account" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete Account" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: `Type ${email}` }).fill(email);
  await confirm.click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in$/);
});
