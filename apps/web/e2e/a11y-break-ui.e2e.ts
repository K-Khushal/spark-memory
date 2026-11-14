import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// break-ui across the app: worst-case Memories go in through the real API,
// then every surface that shows one must stay inside the screen.
const unbroken = "Supercalifragilisticexpialidocious".repeat(8);
const worst = [
  `${unbroken}\nA body after an unbreakable first line`,
  `${"A very long title that goes on and on about nothing in particular ".repeat(6)}\nBody`,
  "J",
  "दादी की रेसिपी: आम का अचार और नींबू की चटनी, एक पुरानी किताब से",
  "وصفات الجدة: مخلل المانجو وصلصة الليمون من كتاب قديم",
  "🌿🍋🥭🌶️🧄 ".repeat(30),
  "https://example.com/a/very/long/path/".concat("segment/".repeat(40)),
  "Line one\n".repeat(400),
];

async function seed(page: Page) {
  await page.evaluate(async (bodies) => {
    for (const body of bodies)
      await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          captureNote: "N".repeat(40) + " " + "n".repeat(300),
        }),
      });
  }, worst);
  await page.reload();
}

async function inside(page: Page, label: string) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const wide = document.documentElement.scrollWidth - innerWidth;
          const dialog = document.querySelector('[role="dialog"]');
          const box = dialog?.getBoundingClientRect();
          return {
            wide,
            dialog: box
              ? box.left >= -1 &&
                box.right <= innerWidth + 1 &&
                box.top >= -1 &&
                box.bottom <= innerHeight + 1
              : true,
          };
        }),
      { message: label }
    )
    .toEqual({ wide: 0, dialog: true });
}

for (const width of [390, 320]) {
  test(`break-ui: worst-case Memories at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    await seed(page);
    const wall = page.getByRole("list", { name: "All Memories" });
    await expect(wall.getByRole("listitem")).not.toHaveCount(0);
    await inside(page, "wall");

    // Every tile has a name a screen reader can use.
    const names = await wall
      .getByRole("listitem")
      .evaluateAll((items) => items.map((i) => i.getAttribute("aria-label")));
    expect(names.every((name) => name && name.trim().length > 0)).toBe(true);

    // Open each in detail.
    const count = await wall.getByRole("listitem").count();
    for (let i = 0; i < count; i++) {
      const tile = wall.getByRole("listitem").nth(i);
      const name = (await tile.getAttribute("aria-label"))?.slice(0, 30);
      await tile.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog"),
        `detail of "${name}"`
      ).toBeVisible();
      await inside(page, `detail ${i}`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }

    // A search with an unbreakable query and one that finds worst cases.
    for (const query of [unbroken, "line", "Supercali"]) {
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill(query);
      await page.waitForTimeout(400);
      await inside(page, `search menu "${query.slice(0, 12)}"`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      await inside(page, `results "${query.slice(0, 12)}"`);
      await page.getByRole("button", { name: "Clear Search" }).click();
    }
  });
}

test("break-ui: the code step with a very long email", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const email = `${"a".repeat(60)}.${"b".repeat(60)}@${"c".repeat(50)}.example.com`;
  await page.goto("/sign-in");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check Your Email" })
  ).toBeVisible();
  await inside(page, "code step with a long email");
});
