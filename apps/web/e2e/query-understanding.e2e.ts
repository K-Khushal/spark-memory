import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** A small blue PNG dropped on the page, as a person drags a file in. */
async function dropBlueImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fe0";
    context.fillRect(0, 0, 64, 48);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([png], "blue.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"])
      window.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true })
      );
  });
}

const shot = (
  page: Page,
  name: string,
  testInfo: { outputPath: (n: string) => string }
) =>
  page.screenshot({
    path: process.env.FACTORY_SCREENSHOTS_DIR
      ? `${process.env.FACTORY_SCREENSHOTS_DIR}/t12-${name}.png`
      : testInfo.outputPath(`t12-${name}.png`),
  });

test("browses by filter chips with no words, says why, and understands typed filters", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await dropBlueImage(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall.getByRole("listitem")).toHaveCount(1);
  await expect(wall.getByRole("progressbar")).toBeHidden();
  const note = await page.request.post("/api/memories", {
    headers: { origin: new URL(page.url()).origin },
    data: { body: "Quarterly budget planning" },
  });
  expect(note.ok()).toBeTruthy();
  await page.reload();
  await expect(wall.getByRole("listitem")).toHaveCount(2);

  const sidebar = page.getByRole("complementary");
  // Colour: the image's palette is blue, the note has none.
  await sidebar.getByRole("button", { name: "Blue", exact: true }).click();
  const found = page.getByRole("list", { name: "Filtered Memories" });
  await expect(found.getByRole("listitem")).toHaveCount(1);
  await expect(found.getByText("Blue", { exact: true })).toBeVisible();
  await shot(page, "colour-1440", testInfo);
  await sidebar.getByRole("button", { name: "Red", exact: true }).click();
  await expect(page.getByText("No Memories Match")).toBeVisible();
  // Pressing the chosen colour again lets go; so does Clear Search.
  await sidebar.getByRole("button", { name: "Red", exact: true }).click();
  await sidebar.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(found.getByRole("listitem")).toHaveCount(1);
  await expect(found.getByText("Note", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Clear Search", exact: true })
    .first()
    .click();
  await expect(wall.getByRole("listitem")).toHaveCount(2);

  // Typed filters: "images" is a kind, not a word to find.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("images");
  // Enter puts the answer on the wall once the menu has one.
  await expect(page.getByRole("option", { name: /^images/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const direct = page.getByRole("list", { name: "Direct Matches" });
  await expect(direct.getByRole("listitem")).toHaveCount(1);
  await expect(direct.getByText("Image", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Clear Search", exact: true })
    .first()
    .click();

  // Words and a filter together.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("budget from this year");
  await expect(
    page.getByRole("option", { name: /^budget from this year/ })
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(direct.getByRole("listitem")).toHaveCount(1);
  await shot(page, "words-1440", testInfo);
  await page
    .getByRole("button", { name: "Clear Search", exact: true })
    .first()
    .click();

  // Recent searches: one keystroke away, replayed, deleted one at a time, then all.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("option", { name: "images", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "budget from this year", exact: true })
  ).toBeVisible();
  await shot(page, "recent-1440", testInfo);
  await page
    .getByRole("button", { name: "Delete Search images", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "images", exact: true })
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Clear Recent Searches" }).click();
  await expect(
    page.getByRole("option", { name: "budget from this year" })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A phone: the filters are one scrolling row, and nothing spills sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await expect(found.getByRole("listitem")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await shot(page, "colour-390", testInfo);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "colour-390-dark", testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, "colour-1440-dark", testInfo);
});

test("recent searches handle empty, one and worst-case data without horizontal overflow", async ({
  page,
}, testInfo) => {
  await signIn(page);
  let queries: string[] = [];
  await page.route("**/api/search/recent", (route) =>
    route.fulfill({
      json: {
        searches: queries.map((query, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          query,
          searchedAt: new Date().toISOString(),
        })),
      },
    })
  );
  for (const data of [
    [],
    ["Jo"],
    [
      "the dashboard with the purple sidebar and the animation reference from https://design-references.example.com/teams/aleksandra-wisniewska-kowalczyk/projects/interaction-patterns-and-accessible-command-menus/versions/2026-november-final-review",
      "نور الهدى عبد الرحمن — تصميم لوحة التحكم",
      "नानी की दाल बनाने का तरीका",
      "👩🏽‍💻 Animation Notes",
      ...Array.from({ length: 16 }, (_, i) => `Animation Reference ${i + 1}`),
    ],
  ]) {
    queries = data;
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    if (data.length)
      await expect(
        page.getByRole("button", {
          name: `Delete Search ${data[0]}`,
          exact: true,
        })
      ).toBeAttached();
    else
      await expect(
        page.getByRole("option", { name: /^Capture/ })
      ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    if (data.length === 20) await shot(page, "worst-390", testInfo);
    await page.keyboard.press("Escape");
  }
});

test("filter chips hold worst-case Sources: long domains, many, Arabic, none", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  await page.request.post("/api/memories", {
    headers: { origin },
    data: { body: "Seed" },
  });
  const { memories } = (await (
    await page.request.get("/api/memories")
  ).json()) as {
    memories: Record<string, unknown>[];
  };
  const hosts = [
    "bartholomew-fitzgerald-northwind-industries-holdings.example.com",
    "very-long-subdomain.design-references.example.co.uk",
    "instagram.com",
    "youtu.be",
    "تصميم.example.com",
    "news.ycombinator.com",
    "a.io",
  ];
  const many = hosts.flatMap((host, h) =>
    Array.from({ length: h + 1 }, (_, i) => ({
      ...memories[0]!,
      id: crypto.randomUUID(),
      sourceUrl: `https://${host}/p/${i}`,
    }))
  );
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { memories: many } })
      : route.fallback()
  );
  await page.reload();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 700 });
  const aside = page.getByRole("complementary");
  // The four busiest Sources, by name; the rest are left to typing.
  for (const name of [
    "a.io",
    "news.ycombinator.com",
    "تصميم.example.com",
    "YouTube",
  ])
    await expect(
      aside.getByRole("button", { name, exact: true })
    ).toBeVisible();
  await expect(aside.getByRole("button", { name: "Instagram" })).toHaveCount(0);
  await shot(page, "worst-sources-1440", testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "worst-sources-390", testInfo);
});
