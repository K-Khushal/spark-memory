import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("onboarding resumes, captures, searches samples and removes them together", async ({
  page,
}) => {
  // One person's whole first run: sign-in, a reload, a Capture and a search.
  test.setTimeout(60_000);
  await signIn(page);
  const flow = page.getByRole("region", { name: "Get Started" });
  await expect(
    flow.getByText(/AI reads your Memories to Index them/)
  ).toBeVisible();
  await flow.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    flow.getByRole("link", { name: "Install Extension" })
  ).toHaveAttribute("href", /docs\/extension.md/);
  await flow.getByRole("button", { name: "Next", exact: true }).click();
  await flow.getByRole("button", { name: "Skip", exact: true }).click();
  await page.reload();
  await flow.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    flow.getByRole("heading", { name: "Capture a Memory" })
  ).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "My first Memory, a recipe for lemon cake");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  });
  await expect(
    flow.getByRole("heading", { name: "Watch Indexing" })
  ).toBeVisible();
  await flow.getByRole("button", { name: "Open Memory" }).click();
  await page.getByRole("switch", { name: "AI Opt-Out" }).click();
  await page.keyboard.press("Escape");
  await expect(flow.getByText("Searchable", { exact: true })).toBeVisible();
  await flow.getByRole("button", { name: "Try Search" }).click();
  await flow.getByRole("button", { name: "Try a Vague Search" }).click();
  await expect(page.getByPlaceholder("Search…")).toHaveValue(
    "bookshop with a cat"
  );
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /A Quiet Place to Read/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(flow.getByRole("heading", { name: "Ready" })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/onboarding")).json())
          .firstSuccessfulSearchAt
    )
    .toBeTruthy();
  await flow.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(flow.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await flow.getByRole("button", { name: "Remove Samples" }).click();
  await expect(page.getByRole("listitem", { name: /Sample/ })).toHaveCount(0);
});
