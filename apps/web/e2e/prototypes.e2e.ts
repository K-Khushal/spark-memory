import { expect, test } from "@playwright/test";

test("the prototypes route loads its own chunk and renders the reference Library", async ({
  page,
}) => {
  await page.goto("/prototypes?data=empty");
  await expect(page.getByRole("group", { name: "Colour" })).toBeVisible();
  await expect(page.getByRole("button", { name: "White" })).toBeVisible();
});
