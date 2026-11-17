import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function tabTo(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true }).first();
  // Establish keyboard modality so the focus-visible assertion stays meaningful.
  await page.keyboard.press("Tab");
  await target.focus();
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS("outline-style", "solid");
}

test("keyboard Capture, Search, open, Delete returns visible focus to the Library", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await tabTo(page, "Capture");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Cardamom buns with orange zest");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("cardamom");
  const result = page
    .getByRole("listbox")
    .getByRole("option", { name: /Cardamom buns/ });
  await expect(result).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Memory", exact: true })
  ).toBeVisible();
  await tabTo(page, "More");
  await page.keyboard.press("Enter");
  const remove = page.getByRole("menuitem", { name: "Delete", exact: true });
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Capture", exact: true }).first()
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Capture", exact: true }).first()
  ).toHaveCSS("outline-style", "solid");
  await tabTo(page, "Undo");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("listitem", { name: /Cardamom buns/ })
  ).toBeVisible();
});

test("a scrolled Library keeps restored focus inside the viewport", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const captured = await page.request.post("/api/memories", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      id: crypto.randomUUID(),
      body: "A Memory for keyboard navigation",
      captureNote: null,
    },
  });
  expect(captured.ok()).toBe(true);
  const memory = await captured.json();
  const memories = Array.from({ length: 200 }, () => ({
    ...memory,
    id: crypto.randomUUID(),
    indexState: "searchable",
  }));
  await page.route("**/api/memories", (route) =>
    route.fulfill({ json: { memories, unfinished: [] } })
  );
  await page.reload();
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(async () =>
      Number(
        await wall.getByRole("listitem").first().getAttribute("data-index")
      )
    )
    .toBeGreaterThan(0);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const focused = wall.locator('[tabindex="0"]');
  await expect(focused).toBeFocused();
  const bounds = await focused.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    (await page.viewportSize())!.height
  );
});

test("closing Memory detail returns focus to the opened Memory, even when the wall scrolled away", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  const captured = await page.request.post("/api/memories", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      id: crypto.randomUUID(),
      body: "Opened Memory about a lemon tart",
      captureNote: null,
    },
  });
  expect(captured.ok()).toBe(true);
  const memory = await captured.json();
  const others = Array.from({ length: 200 }, (_, i) => ({
    ...memory,
    id: crypto.randomUUID(),
    body: `Other Memory ${i} about travel`,
    // Older than the opened Memory, which leads the wall.
    lastSavedAt: "2020-01-01T00:00:00.000Z",
    indexState: "searchable",
  }));
  await page.route("**/api/memories", (route) =>
    route.fulfill({
      json: {
        memories: [{ ...memory, indexState: "searchable" }, ...others],
        unfinished: [],
      },
    })
  );
  await page.reload();
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name: /Opened Memory/ });
  await expect(tile).toBeVisible();
  const detail = page.getByRole("dialog", { name: "Memory", exact: true });
  // The wall may redraw once as it settles, taking focus with it: ask again.
  await expect(async () => {
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible({ timeout: 1500 });
  }).toPass();
  // The wall moves under the dialog (a refresh, a window resize): the tile
  // that was opened is far out of view.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(async () => await page.evaluate(() => window.scrollY))
    .toBeGreaterThan(1000);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(tile).toBeFocused();
  const bounds = await tile.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    (await page.viewportSize())!.height
  );
});
