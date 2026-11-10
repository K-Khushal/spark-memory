import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("sign in with an email code and land in the empty Library", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();

  // The session survives a reload.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();

  // ⌘K opens the command menu; signing out returns to sign-in.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("option", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
