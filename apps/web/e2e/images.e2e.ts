import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/**
 * Drops files on the page as a person dragging them in would: a small real
 * PNG (drawn on a canvas) and, when asked, a fake one over 25 MB.
 */
async function dropImages(page: Page, { oversized = false } = {}) {
  await page.evaluate(async (oversized) => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fe0";
    context.fillRect(0, 0, 64, 48);
    context.fillStyle = "#ffe15a";
    context.fillRect(8, 8, 24, 24);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([png], "square.png", { type: "image/png" }));
    if (oversized) {
      const big = new Uint8Array(26 * 1024 * 1024);
      data.items.add(new File([big], "huge.png", { type: "image/png" }));
    }
    for (const type of ["dragenter", "dragover", "drop"]) {
      window.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true })
      );
    }
  }, oversized);
}

test("drop images: one is Captured and uploaded, one over 25 MB is refused; view it, then delete it", async ({
  page,
}) => {
  await signIn(page);
  await dropImages(page, { oversized: true });

  await expect(
    page.getByText("Images Over 25 MB Can't Be Captured")
  ).toBeVisible();
  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name: /^Image/ });
  await expect(tile).toHaveCount(1);

  // Uploaded straight to storage, checked, and saved: there after a reload.
  await expect(tile.getByRole("progressbar")).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({
      memories: [{ kind: "image", image: { width: 64, height: 48 } }],
    });
  await page.reload();
  await expect(tile).toBeVisible();
  await expect(tile.locator("img")).toHaveJSProperty("naturalWidth", 64);

  // The viewer shows the Preserved copy; Escape closes it.
  await tile.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("img", { name: /^Image/ })).toBeVisible();
  await expect(viewer.getByRole("img", { name: /^Image/ })).toHaveJSProperty(
    "naturalWidth",
    64
  );
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // Delete for good once the Undo window has passed: the files go too.
  await tile.click();
  await viewer.getByRole("button", { name: "Delete" }).click();
  await expect(tile).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 10_000,
    })
    .toEqual({ memories: [], unfinished: [] });
});

test("a failed upload shows on its tile, and Try Again finishes it", async ({
  page,
}) => {
  await signIn(page);
  let fail = true;
  await page.route("**/api/local-files/**", (route) =>
    fail && route.request().method() === "PUT"
      ? route.fulfill({ status: 503 })
      : route.fallback()
  );
  await dropImages(page);
  const tile = page.getByRole("listitem", { name: /^Image/ });
  await expect(tile.getByText("Failed")).toBeVisible();
  fail = false;
  await tile.getByRole("button", { name: "Try Again" }).click();
  await expect(tile.getByText("Failed")).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ memories: [{ kind: "image" }] });
});

test("an upload a reload cut short shows as Failed, and Delete removes it", async ({
  page,
}) => {
  await signIn(page);
  // The upload never finishes on this page.
  await page.route("**/api/local-files/**", (route) =>
    route.request().method() === "PUT" ? undefined : route.fallback()
  );
  await dropImages(page);
  const tile = page.getByRole("listitem", { name: /^Image/ });
  await expect(tile.getByRole("progressbar")).toBeVisible();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ unfinished: [{ kind: "image" }] });

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.reload();
  await expect(tile).toHaveAccessibleName(/Failed$/);
  await tile.getByRole("button", { name: "Delete" }).click();
  await expect(tile).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 10_000,
    })
    .toEqual({ memories: [], unfinished: [] });
});

test("the viewer keeps focus at the last image, so the arrow keys still work", async ({
  page,
}) => {
  await signIn(page);
  await dropImages(page);
  await dropImages(page);
  const tiles = page.getByRole("listitem", { name: /^Image/ });
  await expect(tiles).toHaveCount(2);
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  await tiles.first().click();
  const viewer = page.getByRole("dialog");
  const next = viewer.getByRole("button", { name: "Next Image" });
  const previous = viewer.getByRole("button", { name: "Previous Image" });
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await next.focus();
  await page.keyboard.press("Enter");
  // The last image: Next is unavailable but keeps focus.
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter"); // nothing further
  await page.keyboard.press("ArrowLeft");
  await expect(next).toHaveAttribute("aria-disabled", "false");
  await expect(previous).toHaveAttribute("aria-disabled", "true");
});
