import { test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// Screenshots for the Categories PR: `CATEGORY_SCREENSHOTS=1 npx playwright test e2e/categories.screenshots.ts`.
// Not a smoke test: it is matched only when asked for.
const OUT = process.env.CATEGORY_SCREENSHOTS_DIR ?? "test-results";
const notes: [string, string[]][] = [
  ["Lemon tart with a short crust, 200g flour, three eggs", ["Recipe"]],
  ["Sourdough starter feeding schedule", ["Recipe", "Tutorial"]],
  ["Nani ki dal tadka, with ghee and cumin", ["Recipe"]],
  ["Lisbon trip: tram 28, pastéis de Belém, Alfama at night", ["Place"]],
  ["Idea: plant watering nudges that learn the sun", ["Idea"]],
  [
    "Passport renewal appointment on the 14th, bring two photos",
    ["Receipt or Document"],
  ],
  ["“Make something people want.”", ["Quote"]],
  ["Debounce in TypeScript with a trailing call", ["Code", "Tutorial"]],
  ["Thesis chapter 3, reviewer comments", ["Other"]],
];

async function seed(page: Page) {
  await signIn(page);
  for (const [text] of notes) {
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
      );
    }, text);
    await page.waitForTimeout(400);
  }
  await page.evaluate(async (notes) => {
    const list = (await (await fetch("/api/memories")).json()) as {
      memories: { id: string; body: string }[];
    };
    for (const m of list.memories) {
      const categories = notes.find(([t]) => t === m.body)?.[1];
      if (categories)
        await fetch(`/api/memories/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories }),
        });
    }
  }, notes);
  await page.reload();
}

for (const [name, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Categories at ${name} ${scheme}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({
        viewport: size,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await seed(page);
      const shot = (label: string) =>
        page.screenshot({ path: `${OUT}/t24-${label}-${name}-${scheme}.png` });
      await page.getByRole("list", { name: "All Memories" }).waitFor();
      await shot("library");
      const filter = page
        .getByRole("button", { name: "Recipe", exact: true })
        .first();
      await filter.click();
      await page.waitForTimeout(300);
      await shot("filtered");
      await page
        .getByRole("list", { name: "All Memories" })
        .getByRole("listitem")
        .first()
        .click();
      await page.getByRole("dialog").locator("summary").click();
      await page.waitForTimeout(300);
      await shot("editor");
      await context.close();
    });
  }
}
