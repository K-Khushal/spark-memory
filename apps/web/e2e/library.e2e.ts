import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** ⌘V outside a text field, with `text` on the clipboard. */
async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

test("paste a Memory, find it by a typo, delete it with Undo", async ({
  page,
}) => {
  await signIn(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name: /Cardamom buns/ });

  await paste(page, "Cardamom buns with orange zest");
  await expect(tile).toBeVisible();
  await expect(page.getByText("Captured")).toBeVisible();

  // It was saved, not just drawn: it is still there after a reload.
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ memories: [{ body: "Cardamom buns with orange zest" }] });
  await page.reload();
  await expect(tile).toBeVisible();

  // Instant search finds it despite the typo.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("cardamon");
  await page.getByRole("option", { name: /Cardamom buns/ }).click();

  // Delete, then Undo: it comes back.
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(tile).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tile).toBeVisible();

  // Delete for good once the Undo window has passed.
  await tile.click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted").last()).toBeVisible();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 10_000,
    })
    .toEqual({ memories: [] });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
});
