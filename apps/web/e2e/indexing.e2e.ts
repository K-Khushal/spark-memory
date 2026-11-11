import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// Indexing end to end on the local stack: Miniflare's queues and the fake
// provider (INDEXING_PROVIDER=fake), which writes "quillfeather" into every
// description it makes, and fails content containing "fake:fail".
const FAKE_WORD = "quillfeather";

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

/** The ⌘K results for `query`, as option names. */
async function search(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill(query);
  return page.getByRole("listbox");
}

test("a Capture goes Indexing, then Searchable, and is found by what Indexing wrote", async ({
  page,
}) => {
  await signIn(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  await paste(page, "Bergamot cake for Sunday");
  await expect(
    wall.getByRole("listitem", { name: "Bergamot cake for Sunday, Indexing" })
  ).toBeVisible();
  // The dashboard polls until it is Searchable: the badge goes.
  await expect(
    wall.getByRole("listitem", { name: "Bergamot cake for Sunday" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(wall.getByText("Indexing")).toHaveCount(0);

  const results = await search(page, FAKE_WORD);
  await expect(
    results.getByRole("option", { name: /Bergamot cake/ })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // AI opt-out: what Indexing wrote is forgotten, and new text is not sent.
  await wall
    .getByRole("listitem", { name: "Bergamot cake for Sunday" })
    .click();
  await page.getByRole("switch", { name: "AI Opt-Out" }).click();
  await expect(page.getByRole("switch", { name: "AI Opt-Out" })).toBeChecked();
  await page
    .getByRole("textbox", { name: "Text" })
    .fill("Bergamot cake, no AI");
  await page.getByRole("button", { name: "Done" }).click();
  const optedOut = wall.getByRole("listitem", {
    name: "Bergamot cake, no AI",
  });
  await expect(optedOut).toBeVisible();
  // Stays Searchable: nothing was queued for a provider.
  await page.waitForTimeout(3000);
  await expect(optedOut).toBeVisible();
  const again = await search(page, FAKE_WORD);
  await expect(again.getByText("No Direct Matches")).toBeVisible();
  await expect(again.getByRole("option", { name: /Bergamot/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const own = await search(page, "bergamot");
  await expect(own.getByRole("option", { name: /Bergamot/ })).toBeVisible();
});

test("a Memory that fails Indexing says why and offers Retry", async ({
  page,
}) => {
  await signIn(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  await paste(page, "This one will fake:fail");
  const tile = wall.getByRole("listitem", {
    name: "This one will fake:fail, Indexing Failed",
  });
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect(tile.getByRole("button", { name: /^Retry/ })).toHaveAttribute(
    "title",
    "Could Not Be Described"
  );

  // Memory detail says why, and its Retry runs Indexing again.
  await tile.click();
  await expect(page.getByText("Could Not Be Described")).toBeVisible();
  const retried = page.waitForResponse(
    (res) => res.url().endsWith("/reindex") && res.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Retry" }).click();
  expect((await retried).status()).toBe(200);
  // The fake fails it again, as it should.
  await expect(page.getByText("Could Not Be Described")).toBeVisible({
    timeout: 15_000,
  });
});

test("a Memory deleted and saved again with its id is Indexed as the new one", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  // Captures choose their id: delete one while its Indexing message is
  // out, save new text under the same id, and only the new text is Indexed.
  const id = crypto.randomUUID();
  const headers = { origin: baseURL! };
  const save = (body: string) =>
    page.request.post("/api/memories", { headers, data: { id, body } });
  expect((await save("Juniper gin notes")).status()).toBe(201);
  expect(
    (await page.request.delete(`/api/memories/${id}`, { headers })).status()
  ).toBeLessThan(300);
  expect((await save("Cardamom bun recipe")).status()).toBe(201);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/memories/${id}`)).json())
          .indexState,
      { timeout: 15_000 }
    )
    .toBe("searchable");
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem", { name: "Cardamom bun recipe" })
  ).toBeVisible();
  const results = await search(page, FAKE_WORD);
  await expect(
    results.getByRole("option", { name: /Cardamom bun/ })
  ).toBeVisible();
  await expect(results.getByRole("option", { name: /Juniper/ })).toHaveCount(0);
});
