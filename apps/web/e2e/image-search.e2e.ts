import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

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
  if (process.env.IMAGE_SCREENSHOTS_DIR) {
    for (const width of [1440, 390])
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          scheme
        );
        await page.screenshot({
          animations: "disabled",
          path: `${process.env.IMAGE_SCREENSHOTS_DIR}/t14-search-${width}-${scheme}.png`,
        });
      }
  }
  await dialog.getByRole("button", { name: "Remove Query Image" }).click();
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
  const memoryId = before.memories.find(
    (m: { body: string }) => m.body === "Lemon tart with a short crust"
  ).id as string;
  await expect(
    dialog
      .getByRole("combobox", { name: "Choose From Library" })
      .locator(`option[value="${memoryId}"]`)
  ).toHaveCount(1);
  const picked = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/search") &&
      req.postDataJSON()?.memory === memoryId
  );
  await dialog
    .getByRole("combobox", { name: "Choose From Library" })
    .selectOption(memoryId);
  expect((await picked).postDataJSON().image).toBeUndefined();
  await expect(
    dialog.getByRole("button", { name: "Remove Query Image" })
  ).toBeVisible();
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
      page.getByRole("combobox", { name: "Choose From Library" })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Worst Case", exact: true }).click();
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
