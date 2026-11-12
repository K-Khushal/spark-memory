import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function tabTo(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true }).first();
  for (
    let i = 0;
    i < 25 && !(await target.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS("outline-style", "solid");
}

test("keyboard Capture, Search, open, Delete returns visible focus to the Library", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await tabTo(page, "Capture");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Cardamom buns with orange zest");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("cardamom");
  const result = page.getByRole("option", { name: /Cardamom buns/ });
  await expect(result).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Memory", exact: true })
  ).toBeVisible();
  await tabTo(page, "Delete");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Capture", exact: true }).first()
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Capture", exact: true }).first()
  ).toHaveCSS("outline-style", "solid");
});
