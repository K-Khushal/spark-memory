import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function swReady(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return Boolean(
          reg?.active || (await navigator.serviceWorker.ready).active
        );
      })
    )
    .toBe(true);
}

/** Document POST to the share target, the way Android Chrome submits it. */
async function sharePost(
  page: Page,
  fields: { title?: string; text?: string; url?: string; file?: boolean }
) {
  await page.evaluate(async (fields) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/share";
    form.enctype = "multipart/form-data";
    for (const name of ["title", "text", "url"] as const) {
      const value = fields[name];
      if (!value) continue;
      const input = document.createElement("input");
      input.name = name;
      input.value = value;
      form.append(input);
    }
    if (fields.file) {
      const canvas = new OffscreenCanvas(32, 24);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2f6fe0";
      context.fillRect(0, 0, 32, 24);
      const png = await canvas.convertToBlob({ type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(new File([png], "shared.png", { type: "image/png" }));
      const input = document.createElement("input");
      input.type = "file";
      input.name = "files";
      input.files = transfer.files;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, fields);
}

test("manifest and service worker are installable", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    display: string;
    share_target: { method: string; enctype: string; action: string };
  };
  expect(manifest.name).toBe("Spark");
  expect(manifest.display).toBe("standalone");
  expect(manifest.share_target).toMatchObject({
    action: "/share",
    method: "POST",
    enctype: "multipart/form-data",
  });

  await page.goto("/sign-in");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest"
  );
  await swReady(page);
});

test("a share-target POST Captures text, and /api is never cached", async ({
  page,
}) => {
  await signIn(page);
  await swReady(page);

  await sharePost(page, { text: "Shared from the share sheet" });
  const tile = page.getByRole("listitem", {
    name: "Shared from the share sheet",
  });
  await expect(tile).toBeVisible();
  await expect(page.getByText("Captured")).toBeVisible();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({
      memories: [{ body: "Shared from the share sheet" }],
    });

  const cachedApi = await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith("/api")) return true;
      }
    }
    return false;
  });
  expect(cachedApi).toBe(false);
});

test("a signed-out share is held until sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await swReady(page);
  await sharePost(page, { text: "Hold this until I sign in" });
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page);
  await expect(
    page.getByRole("listitem", { name: "Hold this until I sign in" })
  ).toBeVisible();
});

test("a shared image is Captured", async ({ page }) => {
  await signIn(page);
  await swReady(page);
  await sharePost(page, { file: true });
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall.getByRole("listitem")).toHaveCount(1);
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({ memories: [{ kind: "image" }] });
});

test("offline, opening Spark shows the offline page", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await swReady(page);
  await context.setOffline(true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Spark Is Offline" })
  ).toBeVisible();
  await context.setOffline(false);
});
