import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** ⌘V outside a text field, with `text` on the clipboard. */
async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

// Gathering reaches the real example.com when the network allows; nothing
// here depends on what it finds, so the smoke stays green offline.
test("paste a link, paste it again, open it to its Source", async ({
  page,
}) => {
  await signIn(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", {
    name: /Example Domain|example\.com/,
  });

  await paste(page, "https://example.com/?utm_source=smoke");
  await expect(tile).toHaveCount(1);
  await expect(page.getByText("Captured")).toBeVisible();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ memories: [{ kind: "link" }] });

  // The same page with other tracking: the Memory already saved, not a second.
  await paste(page, "https://example.com/?fbclid=again");
  await expect(page.getByText("Already in Your Library")).toBeVisible();
  await expect(tile).toHaveCount(1);
  expect(
    (await (await page.request.get("/api/memories")).json()).memories
  ).toHaveLength(1);

  // Memory detail is its reader view, with the way back to the Source.
  await tile.click();
  await expect(page.getByRole("link", { name: "example.com" })).toHaveAttribute(
    "href",
    "https://example.com/?utm_source=smoke"
  );
  await expect(page.getByRole("textbox", { name: "Text" })).toHaveCount(0);
});

test("screenshot upload cannot revive a permanently deleted link", async ({
  page,
}) => {
  await signIn(page);
  const headers = { origin: new URL(page.url()).origin };
  const capture = await page.request.post("/api/memories/links", {
    headers,
    data: {
      url: `https://garden.test/${crypto.randomUUID()}`,
      page: { title: "Basil" },
    },
  });
  expect(capture.ok()).toBe(true);
  const { id } = await capture.json();
  const upload = () =>
    page.request.post(`/api/memories/${id}/screenshot`, {
      headers: { ...headers, "content-type": "image/jpeg" },
      data: Buffer.from([255, 216, 255, 217]),
    });
  expect((await upload()).ok()).toBe(true);
  expect((await page.request.get(`/api/memories/${id}/screenshot`)).ok()).toBe(
    true
  );
  expect(
    (await page.request.delete(`/api/memories/${id}`, { headers })).status()
  ).toBe(204);
  expect((await upload()).status()).toBe(404);
  expect(
    (await page.request.get(`/api/memories/${id}/screenshot`)).status()
  ).toBe(404);
});
