import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("see this device, export the Library, delete the account", async ({
  page,
}) => {
  const email = await signIn(page);
  const libraryMemories = await page
    .getByRole("link", { name: "All Memories" })
    .boundingBox();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // The heading arrives with Settings, after the Library has gone.
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // Usage: each counted limit is a meter with its value in words. Nothing is
  // counted yet (Samples never count); one Capture counts as one today.
  const meter = (name: string) => page.getByRole("meter", { name });
  await expect(meter("Storage")).toHaveAttribute(
    "aria-valuetext",
    "0 B of 1 GB"
  );
  await expect(meter("Captures Today")).toHaveAttribute("aria-valuenow", "0");
  await expect(meter("Deep Fetches Today")).toHaveAttribute(
    "aria-valuetext",
    /^0 of 20\. Resets at /
  );
  await page.evaluate(() =>
    fetch("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Counted once" }),
    })
  );
  await page.reload();
  await expect(meter("Captures Today")).toHaveAttribute("aria-valuenow", "1");
  await expect(meter("Captures Today")).toHaveAttribute(
    "aria-valuetext",
    /^1 of 100\./
  );
  const memories = page.getByRole("link", { name: "All Memories" });
  await expect(memories).toBeVisible();
  // Capture and Search stay in the shared head, so All Memories does not jump.
  expect((await memories.boundingBox())!.y).toBe(libraryMemories!.y);
  const sidebar = page.getByRole("complementary");
  await sidebar.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByRole("dialog", { name: "Capture" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // ⌘K and / live on the desk, so they open Search from Settings too.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "Search" })
  ).toBeFocused();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "Search" })
  ).toBeFocused();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "From settings");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  });
  // Paste outside a field stays on Settings. The clipboard is not dropped
  // into an empty Capture.
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("dialog", { name: "Capture" })).toHaveCount(0);

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

  // Deleting needs the address typed. ⌘K in that field stays on Settings.
  await page.getByRole("button", { name: "Delete Account" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete Account" });
  await expect(confirm).toBeDisabled();
  const emailField = dialog.getByRole("textbox", { name: `Type ${email}` });
  await emailField.fill("keep-this");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(dialog).toBeVisible();
  await expect(emailField).toHaveValue("keep-this");
  await emailField.fill(email);
  await confirm.click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in$/);
});
