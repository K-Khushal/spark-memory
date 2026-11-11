import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// Hybrid search end to end on the local stack: the fake embedder
// (INDEXING_PROVIDER=fake) reads "twilight", "dusk" and "sunset" as one
// meaning, and "harbor", "port" and "dock" as another (FAKE_MEANINGS).

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

/** Captures `text` and waits for it to be Searchable. */
async function capture(page: Page, text: string) {
  await paste(page, text);
  await expect(
    page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem", { name: text, exact: true })
  ).toBeVisible({ timeout: 15_000 });
}

test("finds a Memory by meaning, says what matched, and finds More Like This", async ({
  page,
}) => {
  await signIn(page);
  await capture(page, "Sunset over the dock");
  await capture(page, "Grocery list: eggs and milk");

  // None of these words are in either Memory: instant search finds
  // nothing, and the full search, once typing pauses, finds the sunset.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  const menu = page.getByRole("listbox");
  await expect(
    menu.getByRole("option", { name: "Sunset over the dock" })
  ).toBeVisible();
  await expect(menu.getByRole("option", { name: /Grocery/ })).toHaveCount(0);

  // Enter puts the results on the wall, each with its why-chip.
  await page.keyboard.press("Enter");
  const direct = page.getByRole("list", { name: "Direct Matches" });
  const first = direct.getByRole("listitem").first();
  await expect(first).toHaveAccessibleName("Sunset over the dock, Overview");
  await expect(first.getByText("Overview")).toBeVisible();
  await expect(page.locator("[data-search=full]")).toBeVisible();

  // A Memory that finishes Indexing while the results are up joins them:
  // the search runs again, without being asked.
  await paste(page, "Dusk by the port");
  await expect(
    direct.getByRole("listitem", { name: "Dusk by the port, Overview" })
  ).toBeVisible({ timeout: 15_000 });

  // More Like This, from Memory detail.
  await page.getByRole("button", { name: "Clear Search" }).click();
  const wall = page.getByRole("list", { name: "All Memories" });
  await wall.getByRole("listitem", { name: "Sunset over the dock" }).click();
  await page.getByRole("button", { name: "More Like This" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const similar = page.getByRole("list", { name: "More Like This" });
  await expect(
    similar.getByRole("listitem", { name: "Dusk by the port" })
  ).toBeVisible();
  await expect(
    similar.getByRole("listitem", { name: "Sunset over the dock" })
  ).toHaveCount(0);
  await expect(similar.getByRole("listitem", { name: /Grocery/ })).toHaveCount(
    0
  );

  // With AI opt-out a Memory has no vectors: More Like This goes.
  await page.getByRole("button", { name: "Clear Search" }).click();
  await wall.getByRole("listitem", { name: "Dusk by the port" }).click();
  const moreLikeThis = page.getByRole("button", { name: "More Like This" });
  await expect(moreLikeThis).toBeVisible();
  await page.getByRole("switch", { name: "AI Opt-Out" }).click();
  await expect(moreLikeThis).toHaveCount(0);
});

test("a search run again after leaving the Library sees what was Indexed meanwhile", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  // Searched once in an empty Library: the answer is kept for this visit.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  await expect(page.getByText("No Direct Matches").first()).toBeVisible();
  await page.waitForTimeout(1000); // the full answer lands after a pause
  await page.keyboard.press("Escape");

  // Away in Settings, a Memory that matches is Captured and Indexed.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const res = await page.request.post("/api/memories", {
    headers: { origin: baseURL! },
    data: { body: "Sunset over the dock" },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/memories/${id}`)).json()) as {
            indexState: string;
          }
        ).indexState,
      { timeout: 15_000 }
    )
    .toBe("searchable");

  // Back in the Library, the same search finds it.
  await page.getByRole("link", { name: "All Memories" }).click();
  await expect(
    page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem", { name: "Sunset over the dock" })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  await expect(
    page
      .getByRole("listbox")
      .getByRole("option", { name: "Sunset over the dock" })
  ).toBeVisible();
});
