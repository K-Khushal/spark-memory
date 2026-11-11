import { expect, type Page } from "@playwright/test";

/** Signs a person in with an email code from the local dev outbox. */
export async function signIn(page: Page, address?: string) {
  const email =
    address ??
    `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  // Each test signs in from its own address, so the per-IP limit on sending
  // codes (3 a minute) never trips when tests run side by side.
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const ip = `10.${octet()}.${octet()}.${octet()}`;
  await page.route("**/api/**", (route) =>
    route.fallback({
      headers: { ...route.request().headers(), "cf-connecting-ip": ip },
    })
  );

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
  // LibraryPage has mounted (its shortcuts are listening). The empty
  // heading or the wall, not the sidebar link, is what it renders. A
  // known address may already have Memories from an earlier run.
  await expect(
    page
      .getByRole("heading", { name: "No Memories Yet" })
      .or(page.getByRole("list", { name: "All Memories" }))
  ).toBeVisible();
}
