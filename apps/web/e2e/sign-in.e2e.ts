import { expect, test } from "@playwright/test";

test("sign in with an email code and land in the empty Library", async ({
  page,
}) => {
  const email = `smoke-${Date.now()}@example.com`;

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check Your Email" })
  ).toBeVisible();

  // The local Worker keeps the code in its dev outbox instead of emailing it.
  const res = await page.request.get(
    `/api/dev/sign-in-code?email=${encodeURIComponent(email)}`
  );
  const { code } = (await res.json()) as { code: string };
  await page.getByRole("textbox", { name: "Code" }).fill(code);

  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

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
