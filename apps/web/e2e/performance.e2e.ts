import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("a completed menu search reaches the wall without another search request", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  const captured = await page.request.post("/api/memories", {
    headers: { origin: baseURL! },
    data: { body: "Sunset over the dock" },
  });
  expect(captured.status()).toBe(201);
  const { id } = (await captured.json()) as { id: string };
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
  await page.reload();
  await expect(
    page.getByRole("listitem", { name: "Sunset over the dock", exact: true })
  ).toBeVisible();
  const searches: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search")
      searches.push(request.postDataJSON().mode as string);
  });
  const expectSettledSearches = async () => {
    await expect
      .poll(
        async () => {
          const before = searches.length;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { before, after: searches.length };
        },
        { timeout: 2_000 }
      )
      .toEqual({ before: 2, after: 2 });
  };
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("twilight harbor");
  await expect(page.getByRole("listbox")).toHaveAttribute(
    "data-search-mode",
    "full"
  );
  await expect(
    page.getByRole("option", { name: "Sunset over the dock" })
  ).toBeVisible();
  await expectSettledSearches();
  expect(searches).toEqual(["instant", "full"]);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Direct Matches" }).getByRole("listitem")
  ).toHaveAccessibleName("Sunset over the dock, Overview");
  await expectSettledSearches();
  expect(searches).toEqual(["instant", "full"]);
  // The same full answer is reused when Search is opened again.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("listbox")).toHaveAttribute(
    "data-search-mode",
    "full"
  );
  await expectSettledSearches();
  expect(searches).toEqual(["instant", "full"]);
});
