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
      // Titles clamp to two lines (26px at 17px text, 24px on a phone lane).
      expect(await title.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
        2 * 26 * scale + 1
      );
      // Two lanes on a phone (one at 200% text); the desktop's 220px lanes.
      const lanes = await page
        .locator('main [role="listitem"]')
        .evaluateAll(
          (tiles) =>
            new Set(
              tiles.map((tile) =>
                Math.round(tile.getBoundingClientRect().left + scrollX)
              )
            ).size
        );
      if (width < 640) expect(lanes).toBe(scale === 2 ? 1 : 2);
      else if (scale === 1) expect(lanes).toBeGreaterThanOrEqual(2);
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
    page.getByRole("heading", { name: "No Memories Match" })
  ).toBeVisible();
  // Focus lands on the one action, not on a heading.
  const clear = page.getByRole("button", { name: "Clear Search", exact: true });
  await expect(clear.last()).toBeFocused();
  await clear.last().click();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  mock.delay = 3000;
  await page.getByRole("link", { name: "All Memories", exact: true }).click();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible({
    timeout: 1000,
  });
});

test("First-use action has no competing empty state", async ({
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
  // The band is the screen's one action: no heading under it either.
  await expect(page.getByRole("region", { name: "Get Started" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Capture/ }).first()
  ).toBeVisible(); // the sidebar's, not a second one in the wall
  await expect(page.locator("[data-empty-state] button")).toBeHidden();
});

for (const width of [320, 390]) {
  for (const scale of [1, 2]) {
    for (const theme of ["light", "dark"] as const) {
      test(`Bulk actions clear Undo at ${width}px, ${theme}, ${scale * 100}% text`, async ({
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
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
          window.dispatchEvent(new Event("resize"));
        }, scale);
        if (scale === 1) {
          const navigation = await page
            .getByRole("button", { name: "Spark Navigation", exact: true })
            .boundingBox();
          const capture = await page
            .getByRole("button", { name: "Capture", exact: true })
            .filter({ visible: true })
            .first()
            .boundingBox();
          expect(Math.abs(capture!.y - navigation!.y)).toBeLessThan(5);
        }
        const tile = page
          .getByRole("list", { name: "All Memories" })
          .getByRole("listitem")
          .first();
        if (scale === 1) {
          await tile.hover();
          const checkbox = tile.getByRole("checkbox");
          await checkbox.click();
          await expect(checkbox).toBeChecked();
          await expect(
            tile.getByRole("button", { name: /^Select/ })
          ).toHaveCount(0);
        } else {
          await tile.focus();
          await page.keyboard.press("Space");
        }
        await page.evaluate(() => {
          const data = new DataTransfer();
          data.setData("text/plain", "A recipe for the weekend");
          document.body.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
          );
        });
        const bar = page.getByRole("region", {
          name: "Selection",
          exact: true,
        });
        const undo = page.getByRole("button", { name: "Undo", exact: true });
        await expect(bar).toBeVisible();
        await expect(undo).toBeVisible();
        // Sonner enters from below its final offset; compare the settled surfaces.
        await expect
          .poll(async () => {
            const selection = await bar.boundingBox();
            const toast = await undo
              .locator("xpath=ancestor::li")
              .boundingBox();
            return selection!.y - (toast!.y + toast!.height);
          })
          .toBeGreaterThanOrEqual(11);
        const toast = await undo.locator("xpath=ancestor::li").boundingBox();
        expect(toast!.x).toBeGreaterThanOrEqual(0);
        expect(toast!.x + toast!.width).toBeLessThanOrEqual(width);
        expect(toast!.y).toBeGreaterThanOrEqual(0);
        const selection = await bar.boundingBox();
        expect(selection!.y + selection!.height).toBeLessThanOrEqual(
          844 - 16 * scale + 1
        );
        if (evidence)
          await page.screenshot({
            path: `${evidence}/bulk-undo-${width}-${theme}-text-${scale}.png`,
          });
      });
    }
  }
}

test("phone Navigation preserves the query, filters and scroll on return", async ({
  page,
  context,
}) => {
  const memories = tourMemories();
  const notes = memories.filter((m) => m.kind === "text");
  await installLibrary(context, {
    memories,
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {
      garden: {
        direct: notes.slice(0, 3).map((m) => m.id),
        related: notes.slice(3).map((m) => m.id),
      },
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("garden");
  await page.keyboard.press("Enter");
  await page
    .locator("main")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Direct Matches" })
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(400);
  const navigation = page.getByRole("button", {
    name: "Spark Navigation",
    exact: true,
  });
  // Click the visible sticky header without an automation scroll-to-element first.
  const trigger = (await navigation.boundingBox())!;
  await page.mouse.click(
    trigger.x + trigger.width / 2,
    trigger.y + trigger.height / 2
  );
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("list", { name: "Direct Matches" })
  ).toBeVisible();
  await expect(page.locator('[data-desk="search"]:visible')).toContainText(
    "garden"
  );
  await expect(
    page.locator("main").getByRole("button", { name: "Notes", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(400);
});

test("Library-owned phone sheets keep their footer above a scrolling body", async ({
  page,
  context,
}) => {
  await installLibrary(context, {
    memories: tourMemories(),
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await page.setViewportSize({ width: 320, height: 600 });
  await signIn(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  let sheet = 0;
  const checkSheet = async (title: string) => {
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toHaveAttribute("data-presentation", "sheet");
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return Math.round(box!.x + box!.width);
      })
      .toBe(320);
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return Math.round(box!.y + box!.height);
      })
      .toBe(600);
    const heading = dialog.getByRole("heading");
    expect(
      await heading.evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBeLessThanOrEqual(1);
    const body = dialog.locator('[data-slot="dialog-body"]');
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const footer = await dialog
      .locator('[data-slot="dialog-footer"]')
      .boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(601);
    expect(footer!.y).toBeGreaterThanOrEqual(0);
    if (evidence)
      await page.screenshot({
        path: `${evidence}/sheet-${title.toLowerCase()}-${sheet++}-320-text-2.png`,
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  };
  await page
    .getByRole("button", { name: "Capture", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await checkSheet("Capture");
  await page
    .getByRole("button", { name: "Manage Categories", exact: true })
    .filter({ visible: true })
    .click();
  await checkSheet("Categories");
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem")
    .first();
  await tile.focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("region", { name: "Selection", exact: true })
    .getByRole("button", { name: "Categories", exact: true })
    .click();
  await checkSheet("Categories");
});

test("a pointer-selected Checkbox leaves Escape and Search shortcuts available", async ({
  page,
  context,
}) => {
  await installLibrary(context, {
    memories: tourMemories(),
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await signIn(page);
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem")
    .first();
  await tile.hover();
  const checkbox = tile.getByRole("checkbox");
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const bar = page.getByRole("region", { name: "Selection", exact: true });
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Search", exact: true })
  ).toBeVisible();
});
