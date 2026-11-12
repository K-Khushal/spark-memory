import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { loadRootEnv } from "@spark/config/load-env";
import { signIn } from "./sign-in";

loadRootEnv();

/** An image goes by its Capture day until Indexing (the fake provider, locally) names it. */
const IMAGE_NAME = /^(Image|Fake Image Title)/;

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
  const tile = wall.getByRole("listitem", { name: IMAGE_NAME });
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
  await expect(viewer.getByRole("img", { name: IMAGE_NAME })).toBeVisible();
  await expect(viewer.getByRole("img", { name: IMAGE_NAME })).toHaveJSProperty(
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
  const tile = page.getByRole("listitem", { name: IMAGE_NAME });
  await expect(tile.getByText("Failed")).toBeVisible();
  fail = false;
  await tile.getByRole("button", { name: "Try Again" }).click();
  await expect(tile.getByText("Failed")).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ memories: [{ kind: "image" }] });
});

/** Ages an upload past the presigned PUT (15 minutes) so the wall may offer Delete. */
async function ageUpload(memoryId: string) {
  const require = createRequire(
    new URL("../../server/package.json", import.meta.url)
  );
  const { Client } = require("pg") as {
    Client: new (config: { connectionString: string | undefined }) => {
      connect(): Promise<void>;
      query(text: string, values: string[]): Promise<unknown>;
      end(): Promise<void>;
    };
  };
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `update memory_file set created_at = now() - interval '20 minutes' where memory_id = $1`,
    [memoryId]
  );
  await db.end();
}

test("an upload a reload cut short stays until its PUT expires, then the viewer offers only Delete", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  // The PUT never lands, so nothing is stored and confirm never runs.
  await page.route("**/api/local-files/**", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback()
  );
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/memories/images") &&
      res.request().method() === "POST" &&
      res.ok()
  );
  await dropImages(page);
  const { memory } = (await (await created).json()) as {
    memory: { id: string };
  };
  const tile = page.getByRole("listitem", { name: IMAGE_NAME });
  await expect(tile.getByText("Failed")).toBeVisible();
  // The Memory exists, but a live PUT is not listed for another tab to delete.
  expect((await page.request.get(`/api/memories/${memory.id}`)).status()).toBe(
    200
  );
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toEqual({ memories: [], unfinished: [] });

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.reload();
  await expect(tile).toHaveCount(0);

  await ageUpload(memory.id);
  await page.reload();
  await expect(tile).toHaveAccessibleName(/Failed$/);
  const fetches: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "GET" &&
      req.url().includes(`/api/memories/${memory.id}`)
    ) {
      fetches.push(req.url());
    }
  });
  await tile.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.locator("img")).toHaveCount(0);
  await expect(viewer.getByText("AI Opt-Out")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(viewer.locator(".rounded-tile")).toHaveCSS(
    "background-image",
    /data:image/
  );
  expect(fetches).toEqual([]);

  await viewer.getByRole("button", { name: "Delete" }).click();
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
  const tiles = page.getByRole("listitem", { name: IMAGE_NAME });
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
