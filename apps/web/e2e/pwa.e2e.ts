import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function swReady(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const ready = reg?.active ? reg : await navigator.serviceWorker.ready;
        // Activation precedes clients.claim(); offline navigation and share
        // interception need this page to be controlled, not merely an active worker.
        return Boolean(ready.active && navigator.serviceWorker.controller);
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

const memories = async (page: Page) =>
  (
    (await (await page.request.get("/api/memories")).json()) as {
      memories: { body: string | null }[];
    }
  ).memories;

/** Puts a text share straight into the hold, as the worker would. */
async function holdText(page: Page, text: string) {
  await page.evaluate(async (text) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("spark-share", 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("pending"))
          req.result.createObjectStore("pending", { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").add({
        id: crypto.randomUUID(),
        verified: true,
        title: "",
        text,
        url: "",
        files: [],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, text);
}

const heldCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("spark-share", 2);
        req.onsuccess = () => {
          const count = req.result
            .transaction("pending")
            .objectStore("pending")
            .count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        req.onerror = () => reject(req.error);
      })
  );

/** A page on another site that posts a text share to Spark when its form is sent. */
async function attackerPost(
  page: Page,
  baseURL: string | undefined,
  policy: string
) {
  const attacker = await page.context().newPage();
  await attacker.route("https://evil.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<meta name="referrer" content="${policy}" />
        <form id="f" method="POST" action="${baseURL}/share" enctype="multipart/form-data">
        <input name="text" value="Free money" /></form>`,
    })
  );
  await attacker.goto("https://evil.example/");
  await attacker.evaluate(() =>
    (document.getElementById("f") as HTMLFormElement).submit()
  );
  return attacker;
}

test("a form that names its own site is refused and holds nothing", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  await swReady(page);
  const attacker = await attackerPost(page, baseURL, "origin");
  await expect(
    attacker.getByRole("heading", { name: "This Share Can't Be Verified" })
  ).toBeVisible();
  expect(await heldCount(attacker)).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  expect(await memories(page)).toEqual([]);
});

test("a form that hides its site waits for the person, and Discard drops it", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  await swReady(page);
  // https to http sends Origin: null, as no-referrer does from any page.
  const attacker = await attackerPost(page, baseURL, "no-referrer");
  await expect(
    attacker.getByRole("heading", { name: "Capture This Share?" })
  ).toBeVisible();
  await expect(attacker.getByText("Free money")).toBeVisible();
  expect(await memories(page)).toEqual([]);

  await attacker
    .getByRole("dialog")
    .getByRole("button", { name: "Discard" })
    .click();
  await expect.poll(() => heldCount(attacker)).toBe(0);
  await attacker.reload();
  await expect(
    attacker.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  expect(await memories(page)).toEqual([]);
});

test("a share the person agrees to is Captured once", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  await swReady(page);
  const sheet = await attackerPost(page, baseURL, "no-referrer");
  const ask = sheet.getByRole("dialog");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(
    sheet.getByRole("listitem", { name: "Free money" })
  ).toBeVisible();
  await expect.poll(() => heldCount(sheet)).toBe(0);
  expect((await memories(page)).map((m) => m.body)).toEqual(["Free money"]);
});

test("a share past the allowance is refused with a page, not delivered", async ({
  page,
}) => {
  await signIn(page);
  await swReady(page);
  await sharePost(page, { text: "a".repeat(100_001) });
  await expect(
    page.getByRole("heading", { name: "Too Long to Capture" })
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Library" }).click();
  await expect(
    page.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  expect(await memories(page)).toEqual([]);
});

test("two tabs opening at once Capture a held share once", async ({ page }) => {
  await signIn(page);
  await swReady(page);
  const other = await page.context().newPage();
  await other.goto("/");
  await expect(
    other.getByRole("heading", { name: "No Memories Yet" })
  ).toBeVisible();
  await holdText(page, "Only once");
  await Promise.all([page.reload(), other.reload()]);
  await expect(page.getByRole("listitem", { name: "Only once" })).toBeVisible();
  await expect(
    other.getByRole("listitem", { name: "Only once" })
  ).toBeVisible();
  await expect.poll(() => heldCount(page)).toBe(0);
  expect((await memories(page)).map((m) => m.body)).toEqual(["Only once"]);
});

test("a share stays held until the server has it, then Captures once", async ({
  page,
}) => {
  await signIn(page);
  await swReady(page);
  await page.route("**/api/memories", (route) =>
    route.request().method() === "POST" ? route.abort() : route.fallback()
  );
  await holdText(page, "Survives a bad connection");
  await page.reload();
  await expect(page.getByText("Capture Did Not Finish")).toBeVisible();
  expect(await heldCount(page)).toBe(1);
  expect(await memories(page)).toEqual([]);

  await page.unroute("**/api/memories");
  await page.reload();
  await expect(
    page.getByRole("listitem", { name: "Survives a bad connection" })
  ).toBeVisible();
  await expect.poll(() => heldCount(page)).toBe(0);
  expect((await memories(page)).map((m) => m.body)).toEqual([
    "Survives a bad connection",
  ]);
});

test("a share an older build held is upgraded, and asks first", async ({
  page,
}) => {
  await signIn(page);
  await swReady(page);
  // The version 1 hold: bare files, no ids, no verified flag; one damaged row.
  await page.evaluate(async () => {
    await new Promise((done) => {
      const gone = indexedDB.deleteDatabase("spark-share");
      gone.onsuccess = gone.onerror = gone.onblocked = () => done(null);
    });
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("spark-share", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("pending", { autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("pending", "readwrite");
      const store = tx.objectStore("pending");
      store.add({ title: "", text: "From an older build", url: "", files: [] });
      store.add("damaged");
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Capture This Share?" })
  ).toBeVisible();
  await expect(page.getByText("From an older build")).toBeVisible();
  await expect(page.getByText("This Share Can't Be Read")).toBeVisible();
  expect(await memories(page)).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Capture", exact: true })
    .click();
  await expect(
    page.getByRole("listitem", { name: "From an older build" })
  ).toBeVisible();
  await expect.poll(() => heldCount(page)).toBe(0);
});
