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
  await expect(restore).toBeVisible();
  // Done without Restore keeps the other page's crash copy.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(restore).toBeHidden();
  await tile.click();
  await expect(note).toHaveValue("");
  await expect(restore).toBeVisible();
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

test("⌘K opens Search, and Settings loads from the Library", async ({
  page,
}) => {
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Loading")).toHaveCount(0);
  await page.getByRole("link", { name: "All Memories" }).click();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
});

/** Vite serves `/src/library/overlays.tsx`; the build hashes `overlays-*.js`. */
const overlaysChunk = (url: URL) =>
  url.pathname.endsWith("/library/overlays.tsx") ||
  /\/overlays-[^/]+\.js$/.test(url.pathname);

test("a rejected overlays chunk leaves the Library up, and ⌘V still captures", async ({
  page,
}) => {
  await page.route(overlaysChunk, (route) => route.abort());
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  await paste(page, "Lemon tart without overlays");
  await expect(page.getByText("Captured", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "Lemon tart without overlays" })
  ).toBeVisible();
});

test("⌘K opens Search once the overlays chunk arrives", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(overlaysChunk, async (route) => {
    await gate;
    await route.continue();
  });
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Search…")).toHaveCount(0);
  release();
  await expect(page.getByPlaceholder("Search…")).toBeVisible();
});

test("change a Memory's Categories, then filter the Library by them", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name: /Sourdough starter/ });
  await paste(page, "Sourdough starter notes");
  await expect(tile).toBeVisible();

  await tile.click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("summary").click();
  await dialog.getByRole("button", { name: "Recipe", exact: true }).click();
  await dialog.getByRole("button", { name: "Other", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog.locator("summary")).toHaveText("Recipe");
  await page.keyboard.press("Escape");

  const categories = page.getByRole("navigation", { name: "Categories" });
  await categories.getByRole("button", { name: "Video" }).click();
  await expect(page.getByText("No Video Memories")).toBeVisible();
  // Narrowed by a Category, All Memories is not the current page.
  await expect(page.getByRole("link", { name: "All Memories" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "All Memories" })
  ).toBeVisible();
  await categories.getByRole("button", { name: "Recipe" }).click();
  await expect(tile).toBeVisible();

  // The chip narrows a search on the wall as well.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("sourdough");
  await expect(page.getByRole("option", { name: /Sourdough/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Direct Matches" }).getByRole("listitem")
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Clear Search" }).click();
  await categories.getByRole("button", { name: "Recipe" }).click();
  await categories.getByRole("button", { name: "Place" }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("sourdough");
  await expect(page.getByRole("option", { name: /Sourdough/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Direct Matches" })).toHaveCount(
    0
  );
  await page.getByRole("button", { name: "All Memories" }).click();
  await expect(
    page.getByRole("link", { name: "All Memories" })
  ).toHaveAttribute("aria-current", "page");
});
