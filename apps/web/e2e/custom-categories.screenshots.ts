import { test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// Screenshots for the custom Categories PR:
// `CUSTOM_CATEGORY_SCREENSHOTS=1 npx playwright test`. Not a smoke test.
const OUT = process.env.CATEGORY_SCREENSHOTS_DIR ?? "test-results";
const notes = [
  "Tomato beds: raised, south facing, mulch in May",
  "Lemon tart with a short crust, 200g flour, three eggs",
  "Lisbon trip: tram 28, pastéis de Belém, Alfama at night",
  "Debounce in TypeScript with a trailing call",
  "Idea: plant watering nudges that learn the sun",
  "“Make something people want.”",
];
const own = [
  "Gardening",
  "Cat Photos",
  "An Unreasonably Long Category Name Here",
  "Weekend Plans 🌿",
  "وصفات الجدة",
  "दादी की रेसिपी",
];

async function seed(page: Page) {
  await signIn(page);
  for (const text of notes) {
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
      );
    }, text);
    await page.waitForTimeout(300);
  }
  await page.evaluate(async (own) => {
    for (const name of own) {
      await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    }
    const list = (await (await fetch("/api/memories")).json()) as {
      memories: { id: string; body: string }[];
    };
    const tomato = list.memories.find((m) => m.body?.startsWith("Tomato"));
    if (tomato) {
      await fetch(`/api/memories/${tomato.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ["Gardening", "Idea"] }),
      });
    }
  }, own);
}

for (const [name, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Custom Categories at ${name} ${scheme}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({
        viewport: size,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await seed(page);
      // A run part of the way through, whatever the local queue has done.
      await page.route("**/api/categories", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const res = await route.fetch();
        const body = (await res.json()) as object;
        await route.fulfill({
          response: res,
          json: { ...body, run: { done: 12, total: 40 } },
        });
      });
      await page.reload();
      await page.getByRole("list", { name: "All Memories" }).waitFor();
      await page.waitForTimeout(600);
      const shot = (label: string) =>
        page.screenshot({
          path: `${OUT}/t25-${label}-${name}-${scheme}.png`,
        });
      await shot("library");
      const manage = page
        .getByRole("button", { name: "Manage Categories" })
        .filter({ visible: true })
        .first();
      await manage.click();
      await page.waitForTimeout(300);
      await shot("manage");
      await page.getByRole("button", { name: /^Delete Gardening/ }).click();
      await page.waitForTimeout(300);
      await shot("delete");
      await context.close();
    });
  }
}
