import { expect, type Page } from "@playwright/test";

/**
 * The widget is a third-party boundary. Use Cloudflare's public test token so
 * smoke tests exercise real Spark sign-in without depending on the challenge
 * iframe's availability in this sandbox.
 */
export async function stubTurnstile(page: Page) {
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js**",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `(() => {
      const widgets = new Map();
      const complete = id => setTimeout(() => widgets.get(id)?.callback?.("XXXX.DUMMY.TOKEN.XXXX"), 0);
      window.turnstile = {
        render: (_container, options) => { const id = "test-" + widgets.size; widgets.set(id, options); complete(id); return id; },
        getResponse: () => "XXXX.DUMMY.TOKEN.XXXX",
        reset: id => complete(id), remove: id => widgets.delete(id),
        execute: () => {}, isExpired: () => false, ready: fn => fn()
      };
      const callback = new URL(document.currentScript.src).searchParams.get("onload");
      if (callback) window[callback]?.();
    })();`,
      })
  );
}

/**
 * Each test signs in from its own address, so the per-IP limit on sending
 * codes (3 a minute) never trips when tests run side by side.
 */
export async function fromOwnAddress(page: Page) {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const ip = `10.${octet()}.${octet()}.${octet()}`;
  await page.route("**/api/**", (route) =>
    route.fallback({
      headers: { ...route.request().headers(), "cf-connecting-ip": ip },
    })
  );
}

/** Signs a person in with an email code from the local dev outbox; returns their address. */
export async function signIn(
  page: Page,
  address?: string,
  returnTo?: string
): Promise<string> {
  await stubTurnstile(page);
  const email =
    address ??
    `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await fromOwnAddress(page);

  await page.goto(returnTo ?? "/");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

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
  if (returnTo) {
    await expect(page).toHaveURL(/\/api\/oauth\/authorize\?/);
    return email;
  }
  await expect(page).toHaveURL(/\/$/);
  // LibraryPage has mounted (its shortcuts are listening). The empty
  // heading or the wall, not the sidebar link, is what it renders. A
  // known address may already have Memories from an earlier run.
  await expect(
    page
      .getByRole("heading", { name: "No Memories Yet" })
      .or(page.getByRole("list", { name: "All Memories" }))
  ).toBeVisible();
  return email;
}
