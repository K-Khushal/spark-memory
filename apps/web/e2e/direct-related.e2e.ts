import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// Direct and Related Matches end to end on the local stack, with the fake
// embedder (INDEXING_PROVIDER=fake): "twilight harbor" reads as "evening
// harbour", which sits very close to "Sunset over the dock" (Direct) and
// only some way from the longer note about seagulls (Related).
const DIRECT = "Sunset over the dock";
const RELATED = "Sunset over the dock with seagulls and boats";
/** Menu rows are named with their why-chip, and one title starts the other. */
const DIRECT_ROW = /^Sunset over the dock(?! with)/;
const RELATED_ROW = /^Sunset over the dock with/;

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

async function capture(page: Page, text: string) {
  await paste(page, text);
  await expect(
    page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem", { name: text, exact: true })
  ).toBeVisible({ timeout: 15_000 });
}

const shot = (
  page: Page,
  name: string,
  testInfo: { outputPath: (n: string) => string }
) =>
  page.screenshot({
    path: process.env.FACTORY_SCREENSHOTS_DIR
      ? `${process.env.FACTORY_SCREENSHOTS_DIR}/t13-${name}.png`
      : testInfo.outputPath(`t13-${name}.png`),
  });

test("says there is no Direct Match, offers no chip that narrows nothing, and splits Direct from Related once there is one", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await capture(page, RELATED);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  const menu = page.getByRole("listbox");
  await expect(menu.getByRole("option", { name: RELATED_ROW })).toBeVisible();
  await page.keyboard.press("Enter");

  // Nothing is a Direct Match: it says so, and the layout does the rest.
  await expect(
    page.getByRole("heading", { name: "No Direct Matches" })
  ).toBeVisible();
  const related = page.getByRole("list", { name: "Related Matches" });
  await expect(related.getByRole("listitem", { name: RELATED })).toBeVisible();
  await expect(page.getByRole("list", { name: "Direct Matches" })).toHaveCount(
    0
  );
  // One kind, one Category: a chip would narrow nothing, so there is none.
  await expect(
    page.getByRole("group", { name: "Narrow Related Matches" })
  ).toHaveCount(0);
  await shot(page, "zero-direct-1440", testInfo);
  await page.getByRole("button", { name: "Clear Search" }).first().click();

  // A Memory that does match joins the results: Direct above Related.
  await capture(page, DIRECT);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  await expect(menu.getByRole("option", { name: DIRECT_ROW })).toBeVisible();
  await expect(menu.getByRole("option", { name: RELATED_ROW })).toBeVisible();
  // ⌘K: arrows run on from the Direct group into the Related one.
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("option", { name: DIRECT_ROW })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("option", { name: RELATED_ROW })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");

  const direct = page.getByRole("list", { name: "Direct Matches" });
  await expect(direct.getByRole("listitem")).toHaveText([new RegExp(DIRECT)]);
  await expect(related.getByRole("listitem", { name: RELATED })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No Direct Matches" })
  ).toHaveCount(0);
  const sections = await page
    .getByRole("heading", { name: /Matches$/ })
    .allTextContents();
  expect(sections).toEqual(["Direct Matches", "Related Matches"]);
  await shot(page, "direct-related-1440", testInfo);

  // The wall: ↓ from the last Direct tile goes on to Related, ↑ comes back.
  await direct.getByRole("listitem").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(related.getByRole("listitem").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(direct.getByRole("listitem").first()).toBeFocused();
  // Enter opens the Memory the focus is on, whichever section it is in.
  await page.keyboard.press("ArrowDown");
  await expect(related.getByRole("listitem").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(RELATED);
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`screens at ${width}px, ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      test.skip(!process.env.FACTORY_SCREENSHOTS_DIR, "screenshots on request");
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      });
      await signIn(page);
      await capture(page, RELATED);
      await capture(page, DIRECT);
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search…").fill("twilight harbor");
      await expect(
        page.getByRole("listbox").getByRole("option", { name: DIRECT_ROW })
      ).toBeVisible();
      await shot(page, `menu-${width}-${colorScheme}`, testInfo);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("list", { name: "Direct Matches" })
      ).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, `results-${width}-${colorScheme}`, testInfo);
    });
  }
}
