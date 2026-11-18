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
        if (scale === 1) {
          // The count and every control share one row, each 44px to touch.
          const tops = await bar.getByRole("button").evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return {
                y: Math.round(r.y),
                h: Math.round(r.height),
                w: Math.round(r.width),
              };
            })
          );
          expect(tops).toHaveLength(3);
          expect(new Set(tops.map((t) => t.y)).size).toBe(1);
          for (const t of tops)
            expect(Math.min(t.h, t.w)).toBeGreaterThanOrEqual(44);
        }
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

test("text tiles fit font-shaped paragraphs without an empty badge row", async ({
  page,
  context,
}) => {
  const notes = tourMemories()
    .filter((m) => m.kind === "text")
    .slice(0, 5)
    .map((m, i) => ({
      ...m,
      title: null,
      sample: false,
      indexState: "searchable" as const,
      body: [
        "Call the plumber before Friday.",
        "Wide words WWWWWW and narrow iiiiii wrap differently.\n\nKeep the paragraph gap.",
        "日本語の資料とデザインを保存します。長い文章も読みやすく。",
        "नमस्ते दुनिया यह मेरी छोटी सी याद है",
        "مرحبا بالعالم هذه ملاحظة قصيرة للحفظ",
      ][i]!,
    }));
  await installLibrary(context, {
    memories: notes,
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await signIn(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const tiles = page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem");
    await expect(tiles).toHaveCount(notes.length);
    await expect
      .poll(() =>
        tiles.evaluateAll((items) =>
          items
            .map((item) => {
              const body = item.querySelector("p")!;
              const content = body.parentElement!;
              const style = getComputedStyle(content);
              const expected =
                body.getBoundingClientRect().height +
                parseFloat(style.paddingTop) +
                parseFloat(style.paddingBottom);
              return Math.abs(item.getBoundingClientRect().height - expected);
            })
            .every((gap) => gap <= 1)
        )
      )
      .toBe(true);
  }
});

test("Sample text tiles end 12px below the badge on phone lanes", async ({
  page,
  context,
}) => {
  const memory = {
    ...tourMemories().find((m) => m.kind === "text")!,
    sample: true,
    title: "A Quiet Place to Read",
    body: "A small bookshop tucked behind the station. Blue shelves, a window seat, coffee and a sleepy cat. A peaceful stop for the next trip, away from busy streets.",
    indexState: "searchable" as const,
  };
  await installLibrary(context, {
    memories: [memory],
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.evaluate(() => document.fonts.ready);
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem");
  await expect(tile).toHaveCount(1);
  await expect
    .poll(() =>
      tile.evaluate((item) => {
        const badge = [...item.querySelectorAll("span")].find(
          (el) => el.textContent === "Sample"
        )!;
        return Math.round(
          item.getBoundingClientRect().bottom -
            badge.getBoundingClientRect().bottom
        );
      })
    )
    .toBe(12);
});

test("font-aware measurement of a 10k wall stays within the cold and cached budgets", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const cost = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.documentElement).getPropertyValue(
      "--font-sans"
    );
    await document.fonts.load(`400 13px ${family}`, "Garden नमस्ते");
    await document.fonts.ready;
    // Exercise the actual browser canvas and loaded fonts, not a width stub.
    const modulePath = "/src/library/title-lines.ts";
    const { bodyLines } = await import(/* @vite-ignore */ modulePath);
    const bodies = Array.from(
      { length: 10_000 },
      (_, i) =>
        `Measurement ${i}: Garden tools stay dry beside the shed.\n\n${"日本語の資料。 नमस्ते दुनिया. مرحبا بالعالم. Wide WWW and narrow iii. ".repeat(8)}`
    );
    const run = () => {
      const start = performance.now();
      let lines = 0;
      for (const body of bodies) lines += bodyLines(body, 188, 12);
      return { ms: performance.now() - start, lines };
    };
    return { cold: run(), cached: run() };
  });
  console.log(`10k body measurement: ${JSON.stringify(cost)}`);
  expect(cost.cold.lines).toBeGreaterThan(10_000);
  expect(cost.cached.lines).toBe(cost.cold.lines);
  // Generous CPU budgets for shared CI runners; retain the actual timings in output.
  expect(cost.cold.ms).toBeLessThan(10_000);
  expect(cost.cached.ms).toBeLessThan(1_000);
});

test("a 10k Library paints with bounded precision and idle refinement leaves visible tiles still", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const cost = {
      bodies: 0,
      shapingMs: 0,
      responseAt: 0,
      idleChunks: 0,
      maxIdleMs: 0,
      first: undefined as
        undefined | { bodies: number; shapingMs: number; firstPaintMs: number },
    };
    Object.assign(window, { wallMeasurementCost: cost });
    const idle = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) =>
      idle((deadline) => {
        const start = performance.now();
        callback(deadline);
        cost.idleChunks++;
        cost.maxIdleMs = Math.max(cost.maxIdleMs, performance.now() - start);
      }, options);
    const font = Object.getOwnPropertyDescriptor(
      CanvasRenderingContext2D.prototype,
      "font"
    )!;
    Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
      ...font,
      set(value: string) {
        if (/^400 13px/.test(value)) cost.bodies++;
        font.set!.call(this, value);
      },
    });
    const measure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      const start = performance.now();
      const result = measure.call(this, text);
      cost.shapingMs += performance.now() - start;
      return result;
    };
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (
        !cost.responseAt &&
        new URL(response.url).pathname === "/api/memories"
      )
        cost.responseAt = performance.now();
      return response;
    };
    const observer = new MutationObserver(() => {
      if (
        cost.first ||
        !document.querySelector('main [aria-label="All Memories"] > [data-key]')
      )
        return;
      observer.disconnect();
      requestAnimationFrame(() => {
        cost.first = {
          bodies: cost.bodies,
          shapingMs: cost.shapingMs,
          firstPaintMs: performance.now() - cost.responseAt,
        };
      });
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const template = tourMemories().find((m) => m.kind === "text")!;
  const memories = Array.from({ length: 10_000 }, (_, i) => ({
    ...template,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    title: null,
    sample: false,
    indexState: "searchable" as const,
    body: `Memory ${i}: Garden tools stay dry beside the shed. ${"Wide WWW and narrow iii tools for the weekend. ".repeat(i % 7)}`,
  }));
  await installLibrary(context, {
    memories,
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {},
  });
  await signIn(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { wallMeasurementCost: { first?: object } })
            .wallMeasurementCost.first
      )
    )
    .toBeTruthy();
  const cost = await page.evaluate(
    () =>
      (
        window as unknown as {
          wallMeasurementCost: {
            first: { bodies: number; shapingMs: number; firstPaintMs: number };
          };
        }
      ).wallMeasurementCost.first
  );
  console.log(`10k first-paint measurement: ${JSON.stringify(cost)}`);
  expect(cost.bodies).toBeGreaterThan(0);
  expect(cost.bodies).toBeLessThanOrEqual(200);
  // This includes the estimate/layout/React work after the response, not only canvas shaping.
  expect(cost.firstPaintMs).toBeLessThan(1500);
  const positions = () =>
    page
      .locator('main [aria-label="All Memories"] > [data-key]')
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= innerHeight;
            })
            .map(
              (node) =>
                [
                  node.getAttribute("data-key")!,
                  node.getBoundingClientRect().top,
                ] as const
            )
        )
      );
  const before = await positions();
  await page.waitForTimeout(1000); // let several actual idle chunks refine offscreen items
  const after = await positions();
  for (const [key, top] of Object.entries(before))
    expect(after[key]).toBeCloseTo(top, 0);
  // A large jump must also retain its viewport while earlier skipped items finish in idle time.
  await page.evaluate(() => scrollTo(0, 150_000));
  await page.waitForTimeout(300);
  const jumped = await positions();
  expect(Object.keys(jumped).length).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const settled = await positions();
  for (const [key, top] of Object.entries(jumped))
    expect(settled[key]).toBeCloseTo(top, 0);
  const idle = await page.evaluate(() => {
    const { idleChunks, maxIdleMs } = (
      window as unknown as {
        wallMeasurementCost: { idleChunks: number; maxIdleMs: number };
      }
    ).wallMeasurementCost;
    return { chunks: idleChunks, maxMs: maxIdleMs };
  });
  console.log(`10k idle refinement: ${JSON.stringify(idle)}`);
  expect(idle.chunks).toBeGreaterThan(0);
  // The deterministic Masonry test checks the 6ms budget; tolerate runner scheduling here.
  expect(idle.maxMs).toBeLessThan(50);
});
