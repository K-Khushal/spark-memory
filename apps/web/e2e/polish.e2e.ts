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
  const result = page.getByRole("option", { name: /Cardamom buns/ });
  await expect(result).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Memory", exact: true })
  ).toBeVisible();
  await tabTo(page, "Delete");
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
