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
  const download = page.getByRole("link", { name: /^Download, Until / });
  await expect(download).toBeVisible({ timeout: 15_000 });
  const res = await page.request.get((await download.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/\.zip"$/);
  expect((await res.body()).subarray(0, 2).toString()).toBe("PK");

  // The expiry is in the link's name, with no tooltip or caption beside it.
  expect(await download.getAttribute("title")).toBeNull();
  // Within the hour only Download; once it has passed, Export Library too.
  await expect(
    page.getByRole("button", { name: "Export Library" })
  ).toHaveCount(0);
  await page.route("**/api/account/export", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { export: Record<string, unknown> };
    body.export.nextExportAt = new Date(Date.now() - 1000).toISOString();
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await expect(download).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export Library" })
  ).toBeVisible();
  await page.unroute("**/api/account/export");

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
