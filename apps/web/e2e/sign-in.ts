import { expect, type Page } from "@playwright/test";

/** Signs a new person in with an email code from the local dev outbox. */
export async function signIn(page: Page) {
  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

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
  await expect(page).toHaveURL(/\/$/);
}
