import { expect, test } from "@playwright/test";
import { emptyLibrary, signIn } from "./sign-in";

test("sign in with an email code and land in the empty Library", async ({
  page,
}) => {
  await signIn(page);
  await expect(emptyLibrary(page)).toBeVisible();

  // The session survives a reload.
  await page.reload();
  await expect(emptyLibrary(page)).toBeVisible();

  // ⌘K opens the command menu; signing out returns to sign-in.
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "Sign Out" })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
