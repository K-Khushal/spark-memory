import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

async function screenshots(page: Page, surface: string) {
  if (!process.env.IMAGE_SCREENSHOTS_DIR) return;
  for (const width of [1440, 390])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await page.screenshot({
        animations: "disabled",
        path: `${process.env.IMAGE_SCREENSHOTS_DIR}/t14-${surface}-${width}-${scheme}.png`,
      });
    }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("image search accepts files, paste and drop without Capturing the query", async ({
  page,
}) => {
  await signIn(page);
  const captured = await page.request.post("/api/memories", {
    headers: { Origin: new URL(page.url()).origin },
    data: { body: "Lemon tart with a short crust" },
  });
  expect(captured.ok()).toBe(true);
  await page.reload();
  const before = await (await page.request.get("/api/memories")).json();
  await expect(
    page
      .getByRole("button", { name: "Image Query", exact: true })
      .filter({ visible: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Choose From Library" })
  ).toHaveCount(0);
  await screenshots(page, "wall");
  await page.locator('[data-desk="search"]:visible').focus();
  await expect(
    page
      .getByRole("button", { name: "Image Query", exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  const sidebarSearch = page
    .getByRole("complementary")
    .getByRole("button", { name: "Search" });
  await expect(sidebarSearch).toHaveCount(1);
  await expect(sidebarSearch).toBeFocused();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#297dcc";
    ctx.fillRect(0, 0, 2400, 1600);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/api/search") && !!req.postDataJSON()?.image
  );
  await dialog.getByLabel("Query Image File").setInputFiles({
    name: "query.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  const request = await sent;
  expect(request.method()).toBe("POST");
  expect(request.url()).not.toContain("base64");
  const body = request.postDataJSON() as {
    image: { data: string; mime: string };
  };
  expect(body.image.mime).toBe("image/jpeg");
  const size = await page.evaluate(async (image) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:${image.mime};base64,${image.data}`)).blob()
    );
    const size = [bitmap.width, bitmap.height];
    bitmap.close();
    return size;
  }, body.image);
  expect(size).toEqual([1024, 683]);
  await expect(
    dialog.getByRole("button", { name: "Remove Query Image" })
  ).toBeVisible();
  await dialog.getByPlaceholder("Search…").fill("lemon");
  await expect(dialog.getByRole("option", { name: /^lemon/ })).toBeVisible();
  await expect(
    dialog.getByRole("listbox").getByRole("option", { name: /Lemon tart/ })
  ).toBeVisible();
  await screenshots(page, "search");
  await dialog
    .getByRole("button", { name: "Remove Query Image" })
    .press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Remove Query Image" })
  ).toHaveCount(0);
  for (const type of ["paste", "drop"]) {
    await dialog.getByPlaceholder("Search…").evaluate(
      (input, { type, data }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], "query.png", { type: "image/png" })
        );
        input.dispatchEvent(
          type === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
              })
            : new DragEvent("drop", { dataTransfer: transfer, bubbles: true })
        );
      },
      { type, data }
    );
    await expect(
      dialog.getByRole("button", { name: "Remove Query Image" })
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Remove Query Image" }).click();
  }
  await page.keyboard.press("Escape");
  for (const type of ["paste", "drop"]) {
    await page.locator('[data-desk="search"]:visible').evaluate(
      (field, { type, data }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
            "query.png",
            { type: "image/png" }
          )
        );
        field.dispatchEvent(
          type === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
              })
        );
      },
      { type, data }
    );
    await page
      .getByRole("button", { name: "Remove Query Image" })
      .filter({ visible: true })
      .click();
  }
  await page.keyboard.press("ControlOrMeta+k");
  const memoryId = before.memories.find(
    (m: { body: string }) => m.body === "Lemon tart with a short crust"
  ).id as string;
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "All Memories", exact: true }).click();
  await page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem", { name: /Lemon tart/ })
    .click();
  await expect(
    dialog.getByRole("button", { name: "More Like This", exact: true })
  ).toBeVisible();
  const picked = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/search") &&
      req.postDataJSON()?.memory === memoryId
  );
  await dialog
    .getByRole("button", { name: "Search By Image", exact: true })
    .click();
  expect((await picked).postDataJSON().image).toBeUndefined();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("button", { name: "Remove Query Image" })
      .filter({ visible: true })
  ).toContainText("Lemon tart with a short crust");
  const after = await (await page.request.get("/api/memories")).json();
  expect(after.memories.length).toBe(before.memories.length);
});

test("image query controls fit worst-case Library titles and collections", async ({
  page,
}) => {
  await page.goto("/prototypes?imageSearch=1");
  await page.setViewportSize({ width: 320, height: 800 });
  for (const state of [
    "Demo Data",
    "Worst Case",
    "Empty",
    "One",
    "1,000 Memories",
  ]) {
    await page.getByRole("button", { name: state, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Image Query", exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Worst Case", exact: true }).click();
  await page
    .getByRole("button", { name: "Search By Image", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Query Image" })
  ).toContainText("https://example.com/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
    document.documentElement.dir = "rtl";
    document.documentElement.dataset.theme = "dark";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test("an image viewer reuses its Memory vectors and identifies the query chip", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    canvas.getContext("2d")!.fillRect(0, 0, 64, 48);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(new File([png], "square.png", { type: "image/png" }));
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true })
    );
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/memories")).json()).memories[0]
          ?.hasVectors,
      { timeout: 60000 }
    )
    .toBe(true);
  const {
    memories: [memory],
  } = await (await page.request.get("/api/memories")).json();
  await page.reload();
  await page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem")
    .click();
  const viewer = page.getByRole("dialog");
  await expect(
    viewer.getByRole("button", { name: "More Like This", exact: true })
  ).toBeVisible();
  const sent = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/search") &&
      req.postDataJSON()?.memory === memory.id
  );
  await viewer
    .getByRole("button", { name: "Search By Image", exact: true })
    .click();
  expect((await sent).postDataJSON().image).toBeUndefined();
  await expect(viewer).toBeHidden();
  const chip = page
    .getByRole("button", { name: "Remove Query Image" })
    .filter({ visible: true });
  await expect(chip).toContainText(memory.title || memory.indexTitle);
  await expect(chip.locator("img")).toHaveAttribute(
    "src",
    memory.image.thumbnailUrl
  );
  await screenshots(page, "picked");
});
