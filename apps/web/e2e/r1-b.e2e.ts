import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";
import { FINISHED, installLibrary, type Mock } from "./ui-tour-harness";
import { tourMemories } from "./ui-tour-fixtures";

const evidence = process.env.UI_B_EVIDENCE;

test("Library geometry survives narrow widths, large text and long titles", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await installLibrary(context, {
    memories: tourMemories(),
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await signIn(page);
  for (const width of [320, 375, 390, 639, 641, 767, 769, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of width === 320 || width === 1024 ? [1, 2] : [1]) {
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
        window.dispatchEvent(new Event("resize"));
      }, scale);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        )
        .toBeLessThanOrEqual(1);
      const title = page.locator('main [role="listitem"] p[title]').first();
      await title.scrollIntoViewIfNeeded();
      await expect(title).toBeVisible();
      expect(await title.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
        26 * scale + 1
      );
      if (evidence)
        await page.screenshot({
          path: `${evidence}/library-${width}-text-${scale}.png`,
        });
    }
  }
});

test("Empty search recovery, retry and cached return preserve the Library", async ({
  page,
  context,
}) => {
  const mock: Mock = {
    memories: tourMemories(),
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  };
  await installLibrary(context, mock);
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("nothing-found");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "No Direct Matches" })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear Search", exact: true })
    .last()
    .click();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  mock.delay = 3000;
  await page.getByRole("link", { name: "All Memories", exact: true }).click();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible({
    timeout: 1000,
  });
});

test("First-use action has no competing empty-state primary", async ({
  page,
  context,
}) => {
  await installLibrary(context, {
    memories: [],
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: { ...FINISHED, step: "disclosure", paused: false },
    answers: {},
  });
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true })
  ).toBeVisible();
  const empty = page.getByRole("heading", { name: "No Memories Yet" });
  await expect(empty).toBeVisible();
  await expect(
    empty.locator("..").getByRole("button", { name: /Capture/ })
  ).toBeHidden();
});

test("Bulk actions clear Undo at 320px and 200% text", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await installLibrary(context, {
    memories: tourMemories(),
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    window.dispatchEvent(new Event("resize"));
  });
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem")
    .first();
  await tile.focus();
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "A recipe for the weekend");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  });
  const bar = page.getByRole("region", { name: "Selection", exact: true });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(bar).toBeVisible();
  await expect(undo).toBeVisible();
  // Sonner enters from below its final offset; compare the settled surfaces.
  await expect
    .poll(async () => {
      const selection = await bar.boundingBox();
      const toast = await undo.locator("xpath=ancestor::li").boundingBox();
      return selection!.y - (toast!.y + toast!.height);
    })
    .toBeGreaterThanOrEqual(11);
  const toast = await undo.locator("xpath=ancestor::li").boundingBox();
  expect(toast!.x).toBeGreaterThanOrEqual(0);
  expect(toast!.x + toast!.width).toBeLessThanOrEqual(320);
  expect(toast!.y).toBeGreaterThanOrEqual(0);
  const selection = await bar.boundingBox();
  expect(selection!.y + selection!.height).toBeLessThanOrEqual(829);
  if (evidence)
    await page.screenshot({ path: `${evidence}/bulk-undo-320-text-2.png` });
});
