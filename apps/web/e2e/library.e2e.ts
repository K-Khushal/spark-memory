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

test("search keeps up with Captures, and a failed Undo says so", async ({
  page,
}) => {
  await signIn(page);
  await paste(page, "Lemon tart with a short crust");
  await expect(page.getByText("Captured")).toBeVisible();

  // Results on the wall pick up a Capture made while they are showing.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("lemon");
  await expect(page.getByRole("option", { name: /Lemon tart/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const direct = page.getByRole("list", { name: "Direct Matches" });
  await expect(direct.getByRole("listitem")).toHaveCount(1);
  await paste(page, "Lemon curd, three eggs");
  await expect(direct.getByRole("listitem")).toHaveCount(2);

  // Undo whose delete never reaches the server: the Memory comes back.
  await page.route("**/api/memories/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 503 })
      : route.fallback()
  );
  await page.getByRole("button", { name: "Clear Search" }).click();
  await paste(page, "Undo me if you can");
  const tile = page.getByRole("listitem", { name: "Undo me if you can" });
  await expect(tile).toBeVisible();
  // Sonner stacks toasts; the newest one is in front.
  await page
    .locator('[data-sonner-toast][data-front="true"]')
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByText("Undo Did Not Finish")).toBeVisible();
  await expect(tile).toBeVisible();
});

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

  // A draft left on an older revision is offered, never applied: Tab to
  // Restore Your Edit, press Enter, and it comes back.
  const [saved] = (await (await page.request.get("/api/memories")).json())
    .memories as { id: string; body: string; revision: number }[];
  await page.evaluate(
    ([id, body, revision]) =>
      localStorage.setItem(
        `spark-draft:${id}`,
        JSON.stringify({
          fields: { title: "", body, captureNote: "Restored note" },
          baseRevision: revision,
          page: "an earlier page",
        })
      ),
    [saved!.id, saved!.body, saved!.revision - 1] as const
  );
  await tile.click();
  const note = page.getByRole("textbox", { name: "Capture Note" });
  await expect(note).toHaveValue("");
  const restore = page.getByRole("button", { name: "Restore Your Edit" });
  for (
    let i = 0;
    i < 10 && !(await restore.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(restore).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(note).toHaveValue("Restored note");
  await expect(restore).toBeHidden();
  await page.keyboard.press("Escape");

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
    .toEqual({ memories: [], unfinished: [] });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
});
