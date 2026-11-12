import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test.setTimeout(120_000);

test("video transcript timestamps open the privacy-enhanced player", async ({
  page,
}, testInfo) => {
  await signIn(page);
  // Recorded Gather result at the API boundary: independent of YouTube availability.
  await page.route("**/api/memories*", async (route) => {
    const response = await route.fetch();
    if (route.request().method() !== "GET") return route.fulfill({ response });
    const data = await response.json();
    const decorate = (m: Record<string, unknown>) =>
      m.kind === "video"
        ? {
            ...m,
            indexState: "searchable",
            pageTitle: "Garden Film",
            video: {
              transcriptState: "available",
              transcript: [
                { seconds: 0, text: "Welcome to this garden." },
                {
                  seconds: 760,
                  text: "Heliotropism turns leaves towards sunlight.",
                },
              ],
            },
          }
        : m;
    await route.fulfill({
      response,
      json: Array.isArray(data.memories)
        ? { ...data, memories: data.memories.map(decorate) }
        : Array.isArray(data)
          ? data.map(decorate)
          : decorate(data),
    });
  });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://youtu.be/abcdefghijk?t=30");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/memories")).json()).memories[0]
          ?.kind
    )
    .toBe("video");
  await page.reload();
  await expect(
    page.getByRole("listitem", { name: /Garden Film/ })
  ).toBeVisible();
  const saved = (await (await page.request.get("/api/memories")).json())
    .memories[0];
  await page.route("**/api/search?*", (route) =>
    route.fulfill({
      json: {
        mode: "full",
        results: [
          {
            id: saved.id,
            match: "direct",
            part: {
              kind: "passage",
              field: "body",
              start: 23,
              end: 66,
              seconds: 760,
            },
          },
        ],
      },
    })
  );
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("heliotropism");
  await expect(page.getByRole("option", { name: /Garden Film/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Said at 12:40")).toBeVisible();
  const tile = page.getByRole("listitem", { name: /Garden Film/ });
  await tile.click();
  await expect(
    page.getByRole("button", { name: "Play at 12:40", exact: true })
  ).toHaveCount(2);
  await expect(page.locator("iframe[title='YouTube Player']")).toHaveCount(0);
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme
      );
      await expect(page.getByRole("dialog")).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(26, 27, 30)" : "rgb(255, 255, 255)"
      );
      await page.screenshot({
        animations: "disabled",
        path: process.env.CI
          ? testInfo.outputPath(`video-${width}-${theme}.png`)
          : `/data/workspace/spark-memory/.git/factory/r/t19-${width}-${theme}.png`,
      });
    }
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Player</title>" })
  );
  await page
    .getByRole("list", { name: "Transcript" })
    .getByRole("button", { name: "Play at 12:40" })
    .click();
  await expect(page.locator("iframe[title='YouTube Player']")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/abcdefghijk?start=760"
  );
  await expect(page.locator("iframe[title='YouTube Player']")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation"
  );
  await expect(page.getByRole("link", { name: /Open Source/ })).toHaveAttribute(
    "href",
    /t=760s$/
  );
});

test("transcript worst cases stay reachable at narrow widths and zoom", async ({
  page,
}) => {
  await page.goto("/prototypes?video=1");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const state of ["Worst Case", "Empty", "One", "1,000 Rows", "Demo"]) {
      await page.getByRole("button", { name: state, exact: true }).click();
      await expect(
        page.getByRole("link", { name: /Open Source/ })
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Worst Case", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dir = "rtl";
    document.documentElement.dataset.theme = "dark";
  });
  await expect(
    page.getByRole("button", { name: "Play at 59:59" })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
