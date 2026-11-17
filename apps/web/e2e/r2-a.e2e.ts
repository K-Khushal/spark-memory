import { expect, test, type Page } from "@playwright/test";
import { dropImage, paste, settle } from "./a11y-support";
import { signIn } from "./sign-in";

// Round 2, stream A: the wall glides when a Memory is Captured, and never when
// the list changes because a filter or query did.

/** Counts the glides (a `transform` animation) any tile has started. */
async function countGlides(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __glides: number };
    w.__glides = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (
        Array.isArray(keyframes) &&
        keyframes.some((frame) => frame && "transform" in frame)
      )
        w.__glides++;
      return animate.call(this, keyframes, options);
    };
  });
}
const glides = (page: Page) =>
  page.evaluate(() => (window as unknown as { __glides: number }).__glides);

test("narrowing and clearing a filter never glides the wall; a Capture does", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await countGlides(page);
  await signIn(page);
  const wall = page.locator("[data-library-wall] [role=listitem]");
  // A new account has an empty Library: three Captures make the wall.
  const samples = 0;
  await dropImage(page);
  await paste(page, "Plum jam, two jars");
  await expect(wall).toHaveCount(samples + 2);
  await settle(page);

  // Control: a Capture moves the tiles beside it, and they glide.
  const before = await glides(page);
  await paste(page, "Quince paste, one tin");
  await expect(wall).toHaveCount(samples + 3);
  await expect.poll(() => glides(page)).toBeGreaterThan(before);
  await settle(page);

  // Narrowing to Images, then clearing the filter: other lists, no glide.
  const settled = await glides(page);
  const images = page.getByRole("button", { name: "Images", exact: true });
  await images.click();
  await expect(wall).not.toHaveCount(samples + 3);
  await settle(page);
  await images.click();
  await expect(wall).toHaveCount(samples + 3);
  await settle(page);
  expect(await glides(page)).toBe(settled);
});
