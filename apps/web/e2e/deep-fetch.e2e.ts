import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

test.setTimeout(90_000);

type Saved = {
  id: string;
  kind: string;
  body: string | null;
  preservation: string;
  deepFetch: string | null;
};

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

const saved = async (page: Page) =>
  (
    (await (await page.request.get("/api/memories")).json()) as {
      memories: Saved[];
    }
  ).memories;

// example.com says too little to keep (a short page, no readable text), so Gathering
// it comes back thin and a Deep fetch runs. The local Worker answers it from
// a script (DEEP_FETCH_PROVIDER in wrangler.jsonc), so nothing leaves the
// machine but the gather itself, which needs the network.
test("a thin page is fetched again and its text becomes the Preserved copy", async ({
  page,
}) => {
  // Gathering needs example.com and DNS over HTTPS (Workers has no resolver).
  const reachable = await Promise.all(
    [
      "https://example.com/",
      "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
    ].map((url) =>
      fetch(url, {
        headers: { accept: "application/dns-json, text/html" },
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => res.ok && (await res.text()).length > 0)
        .catch(() => false)
    )
  );
  test.skip(
    !reachable.every(Boolean),
    "needs the network to gather example.com"
  );

  await signIn(page);
  await paste(page, `https://example.com/?deep=${Date.now()}`);
  await expect
    .poll(async () => (await saved(page))[0], { timeout: 60_000 })
    .toMatchObject({
      kind: "link",
      preservation: "preserved",
      deepFetch: null,
      body: expect.stringContaining("Spark found these words"),
    });

  await page.reload();
  await page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem")
    .click();
  await expect(page.getByRole("article", { name: "Text" })).toContainText(
    "Spark found these words"
  );
  // Nothing to say once it worked.
  await expect(page.getByText(/Fetching|Deep Fetch/)).toHaveCount(0);
});

test("a Deep fetch that failed says so and offers Try Again", async ({
  page,
}) => {
  await signIn(page);
  let sent = 0;
  const failed = { deepFetch: "failed" };
  // A recorded server answer: independent of any page or engine.
  await page.route("**/api/memories*", async (route) => {
    const response = await route.fetch();
    if (route.request().method() !== "GET") return route.fulfill({ response });
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        memories: (data.memories as Saved[]).map((m) =>
          m.kind === "link" ? { ...m, ...failed } : m
        ),
      },
    });
  });
  await page.route("**/api/memories/*/deep-fetch", async (route) => {
    sent += 1;
    Object.assign(failed, { deepFetch: "fetching" });
    await route.fulfill({
      json: { id: "x", kind: "link", deepFetch: "fetching" },
    });
  });
  // An address no network reaches: the link is saved and stays Reference Only.
  await paste(page, "https://intranet/notes");
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem");
  await expect(tile).toHaveCount(1);
  await tile.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Deep Fetch Failed")).toBeVisible();
  await dialog.getByRole("button", { name: "Try Again" }).click();
  await expect(dialog.getByText("Fetching", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try Again" })).toHaveCount(
    0
  );
  expect(sent).toBe(1);
});
