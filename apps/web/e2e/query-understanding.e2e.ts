import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("browses without words and replays or deletes a recent search", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const response = await page.request.post("/api/memories", {
    headers: { origin: new URL(page.url()).origin },
    data: { body: "Orange animations reference" },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: "Notes", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("list", { name: "Direct Matches" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear Search", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("option", { name: "notes", exact: true })
  ).toBeVisible();
  await page.getByRole("option", { name: "notes", exact: true }).click();
  await page.getByRole("button", { name: "Clear Search", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("button", { name: "Delete Search notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete Search notes", exact: true })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme
      );
      await page.screenshot({
        path: process.env.FACTORY_SCREENSHOTS_DIR
          ? `${process.env.FACTORY_SCREENSHOTS_DIR}/t12-${width}-${theme}.png`
          : testInfo.outputPath(`t12-${width}-${theme}.png`),
        fullPage: true,
      });
    }
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
      ).toBeVisible();
    else
      await expect(
        page.getByRole("option", { name: "Capture", exact: true })
      ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    if (data.length === 20)
      await page.screenshot({
        path: process.env.FACTORY_SCREENSHOTS_DIR
          ? `${process.env.FACTORY_SCREENSHOTS_DIR}/t12-worst-390.png`
          : testInfo.outputPath("t12-worst-390.png"),
      });
    await page.keyboard.press("Escape");
  }
});
