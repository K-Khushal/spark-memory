import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";
import type { Memory } from "../src/library/use-library";

// #15 Polish pass: M2. The search experience end to end, from the keyboard,
// against a stubbed Library and search so every state is reachable: found,
// nothing found, slow, unreachable, and paged. Screenshots on request
// (FACTORY_SCREENSHOTS_DIR, POLISH_PHASE=before|after).

const titles = [
  "Sunset over the dock",
  "नमस्ते दुनिया, यादों की लाइब्रेरी",
  "日本語のデザイン資料",
  "نور الهدى عبد الرحمن",
  "👩🏽‍💻 Design 🧠 📚",
  "Designing a Personal Library Across Languages, Devices and Years, Again and Again",
  "J",
  "Cardamom buns with orange zest",
];
const HITS = 8;

type Part = Record<string, unknown> | null;
const parts: Part[] = [
  { kind: "field", field: "title" },
  { kind: "field", field: "ocr" },
  { kind: "overview" },
  { kind: "visual" },
  { kind: "passage", field: "body", start: 2, end: 30 },
  { kind: "passage", field: "ocr", page: 3, start: 0, end: 4 },
  { kind: "filter", field: "colour", value: "#2f6fe0" },
  { kind: "field", field: "tags" },
];

/**
 * A signed-in Library of mixed Memories, and a search that answers by its
 * words. While `outage.on`, the word "boom" fails; "shift" answers its
 * instant search with three Direct Matches and its full one, late, with two.
 */
async function stub(page: Page) {
  const outage: {
    on: boolean;
    delay: number;
    query: string;
    wait?: Promise<void>;
  } = { on: true, delay: 0, query: "boom" };
  await signIn(page);
  await page.request.post("/api/memories", {
    headers: { origin: new URL(page.url()).origin },
    data: { id: crypto.randomUUID(), body: "base", captureNote: null },
  });
  const {
    memories: [base],
  } = (await (await page.request.get("/api/memories")).json()) as {
    memories: Memory[];
  };
  const kinds = ["text", "image", "link", "pdf", "video", "text"] as const;
  const memories = Array.from({ length: 24 }, (_, i): Memory => {
    const kind = kinds[i % kinds.length]!;
    const visual = kind === "image" || kind === "pdf";
    return {
      ...base!,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      kind,
      title: titles[i % titles.length]!,
      body:
        kind === "text" ? "A recipe worth remembering. ".repeat(2 + i) : null,
      sourceUrl:
        kind === "link"
          ? "https://www.example.com/a"
          : kind === "video"
            ? "https://youtu.be/abcdefghijk"
            : null,
      capturedAt: new Date(Date.now() - i * 60_000).toISOString(),
      lastSavedAt: new Date(Date.now() - i * 60_000).toISOString(),
      indexState: "searchable",
      indexError: null,
      // The one PDF past the Free allowance of 30 pages.
      ...(kind === "pdf" && { pages: i === 3 ? 45 : 12 }),
      categories: [i % 3 ? "Food" : "Design"],
      hasVectors: true,
      aiOptOut: false,
      ...(visual && {
        image: {
          width: 640,
          height: 400 + (i % 5) * 120,
          thumbhash: null,
          url: `/m2-${i % 4}.svg`,
          thumbnailUrl: `/m2-${i % 4}.svg`,
        },
      }),
      ...(kind === "video" && {
        video: { transcriptState: "available", transcript: [] },
      }),
    } as unknown as Memory;
  });
  const palette = ["#24774A", "#2f6fe0", "#C4321C", "#FFE15A"];
  for (const [i, fill] of palette.entries())
    await page.route(`**/m2-${i}.svg`, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${fill}"/><circle cx="320" cy="240" r="120" fill="#fff" opacity=".6"/></svg>`,
      })
    );
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { memories, unfinished: [] } })
      : route.fallback()
  );
  await page.route("**/api/memories?*", (route) =>
    route.fulfill({ json: { memories: [] } })
  );
  await page.route("**/api/search", async (route) => {
    const body = route.request().postDataJSON() as {
      q: string;
      mode: string;
      page?: string;
    };
    const q = body.q.trim();
    if (q === outage.query && outage.on)
      return route.fulfill({ status: 500, json: {} });
    if (q === outage.query && outage.wait) await outage.wait;
    if (q === outage.query && outage.delay)
      await new Promise((done) => setTimeout(done, outage.delay));
    if (q === "slow") await new Promise((done) => setTimeout(done, 1500));
    if (q === "shift") {
      const full = body.mode !== "instant";
      if (full) await new Promise((done) => setTimeout(done, 700));
      const direct = full ? 2 : 3;
      return route.fulfill({
        json: {
          results: Array.from({ length: HITS }, (_, i) => ({
            id: memories[i]!.id,
            match: i < direct ? "direct" : "related",
            part: parts[i % parts.length],
          })),
          mode: full ? "full" : "instant",
        },
      });
    }
    const empty = q === "nothing";
    const direct = q === "zero" ? 0 : 5;
    const hit = (i: number, match: "direct" | "related") => ({
      id: memories[i]!.id,
      match,
      part: parts[i % parts.length],
    });
    const results = empty
      ? []
      : body.page
        ? [hit(HITS + 1, "related"), hit(HITS + 2, "related")]
        : Array.from({ length: HITS }, (_, i) =>
            hit(i, i < direct ? "direct" : "related")
          );
    return route.fulfill({
      json: {
        results,
        mode: body.mode === "instant" ? "instant" : "full",
        ...(q === "paged" && !body.page && { next: "p2" }),
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible();
  return { outage, memories };
}

/** Screenshots for the ticket, only when asked for (FACTORY_SCREENSHOTS_DIR). */
const ticketShot = (page: Page, name: string) =>
  process.env.FACTORY_SCREENSHOTS_DIR
    ? page.screenshot({
        animations: "disabled",
        path: `${process.env.FACTORY_SCREENSHOTS_DIR}/tui2-${name}.png`,
      })
    : undefined;

/** ⌘K, the words, and Enter, as a person at the keyboard does it. */
async function search(page: Page, words: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill(words);
  await expect(
    page.getByRole("option", { name: new RegExp(`^${words}`) })
  ).toBeVisible();
  await page.keyboard.press("Enter");
}

test("a search from the keyboard alone lands on the results, and a search that finds nothing says so where focus is", async ({
  page,
}) => {
  await stub(page);
  await search(page, "harbor");
  const direct = page.getByRole("list", { name: "Direct Matches" });
  await expect(direct).toBeVisible();
  // Focus is on the first Direct tile, ring showing: arrows take it from there.
  await expect(direct.getByRole("listitem").first()).toBeFocused();
  await expect(direct.getByRole("listitem").first()).toHaveCSS(
    "outline-style",
    "solid"
  );

  await page.getByRole("button", { name: "Clear Search" }).first().click();
  await search(page, "nothing");
  await expect(
    page.getByRole("heading", { name: "No Memories Match" })
  ).toBeVisible();
  // Not on Capture, and not on a heading: the one action is next.
  await expect(
    page.getByRole("button", { name: "Clear Search", exact: true }).last()
  ).toBeFocused();
});

test("⌘K gives Search By Image a place in the field's row, not a row of its own", async ({
  page,
}) => {
  await stub(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  const field = await dialog.getByPlaceholder("Search…").boundingBox();
  const button = await dialog
    .getByRole("button", { name: "Image Query" })
    .boundingBox();
  expect(button!.y).toBeGreaterThanOrEqual(field!.y - 4);
  expect(button!.y + button!.height).toBeLessThanOrEqual(
    field!.y + field!.height + 4
  );
  // The first row follows the field directly.
  const first = await dialog.getByRole("option").first().boundingBox();
  expect(first!.y - (field!.y + field!.height)).toBeLessThan(24);

  // A picked image goes back to the field, so Enter searches by it.
  await dialog.getByLabel("Query Image File").setInputFiles({
    name: "q.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  await expect(
    dialog.getByRole("button", { name: "Remove Query Image" })
  ).toBeVisible();
  await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: /Matches$/ }).first()
  ).toBeVisible();
});

test("a search that fails says so the same way in the menu and on the wall, and a slow one dims what is shown", async ({
  page,
}) => {
  await stub(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("boom");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("listbox")
      .getByText("Search Is Unreachable")
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Search Is Unreachable" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear Search" }).first().click();

  const wall = page.locator("[data-library-wall]");
  await expect(wall).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("slow");
  await page.keyboard.press("Enter");
  await expect(wall).toHaveAttribute("aria-busy", "true");
  await expect(wall).toHaveCSS("opacity", "0.6", { timeout: 3000 });
  await expect(page.getByRole("list", { name: "Direct Matches" })).toBeVisible({
    timeout: 8000,
  });
  await expect(wall).toHaveAttribute("aria-busy", "false");
  await expect(wall).toHaveCSS("opacity", "1");
});

test("a search that failed offers Try Again in the menu and on the wall", async ({
  page,
}) => {
  const { outage } = await stub(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("boom");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("listbox").getByText("Search Is Unreachable")
  ).toBeVisible();

  // Still down: Try Again answers the same way, and the menu stays open.
  const again = dialog.getByRole("option", { name: "Try Again" });
  await ticketShot(page, "menu-try-again");
  await again.click();
  await expect(
    dialog.getByRole("listbox").getByText("Search Is Unreachable")
  ).toBeVisible();
  await expect(again).toBeVisible();

  // Back up: Try Again brings the results into the menu.
  outage.on = false;
  await again.click();
  await expect(
    dialog.getByRole("option", { name: /^boom|Sunset/ }).first()
  ).toBeVisible();

  // The wall: the same words and the same action.
  outage.on = true;
  await page.getByPlaceholder("Search…").fill("boom again");
  await page.getByPlaceholder("Search…").fill("boom");
  await expect(
    dialog.getByRole("listbox").getByText("Search Is Unreachable")
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Search Is Unreachable" })
  ).toBeVisible();
  await ticketShot(page, "wall-try-again");
  outage.on = false;
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(
    page.getByRole("list", { name: "Direct Matches" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Search Is Unreachable" })
  ).toHaveCount(0);
});

test("Try Again sends one instant and one full request when the menu and the wall share the failed search", async ({
  page,
}) => {
  const { outage } = await stub(page);
  const modes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/search"))
      modes.push((request.postDataJSON() as { mode: string }).mode);
  });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("boom");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("listbox").getByText("Search Is Unreachable")
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Search Is Unreachable" })
  ).toBeVisible();

  // The menu again, on the words the wall failed on.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("boom");
  await expect(
    dialog.getByRole("listbox").getByText("Search Is Unreachable")
  ).toBeVisible();
  await page.waitForTimeout(600);
  modes.length = 0;
  outage.on = false;
  await dialog.getByRole("option", { name: "Try Again" }).click();
  await expect(
    dialog.getByRole("option", { name: /^Sunset over the dock/ })
  ).toBeVisible();
  await page.waitForTimeout(600);
  expect(modes.sort()).toEqual(["full", "instant"]);
});

test("Try Again says it is searching again, and marks the menu and the wall busy until the answer lands", async ({
  page,
}) => {
  const { outage } = await stub(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("boom");
  const dialog = page.getByRole("dialog");
  const list = dialog.getByRole("listbox");
  await expect(list.getByText("Search Is Unreachable")).toBeVisible();
  await expect(list).toHaveAttribute("aria-busy", "false");

  outage.on = false;
  let release!: () => void;
  outage.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await dialog.getByRole("option", { name: "Try Again" }).click();
  await expect(list).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Searching Again" })
  ).toHaveCount(1);
  release();
  outage.wait = undefined;
  await expect(list).toHaveAttribute("aria-busy", "false", { timeout: 5000 });

  // The wall.
  outage.on = true;
  outage.delay = 0;
  // Use a fresh request key; the first retry deliberately cached a successful answer.
  outage.query = "boom wall";
  await page.getByPlaceholder("Search…").fill(outage.query);
  await expect(list.getByText("Search Is Unreachable")).toBeVisible();
  await page.keyboard.press("Enter");
  const wall = page.locator("[data-library-wall]");
  await expect(
    page.getByRole("heading", { name: "Search Is Unreachable" })
  ).toBeVisible();
  await expect(wall).toHaveAttribute("aria-busy", "false");
  // Reopening a failed query must not announce the same failure from two regions.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(list.getByText("Search Is Unreachable")).toBeVisible();
  const failureStatus = page
    .locator('[role="status"]')
    .filter({ hasText: "Search Is Unreachable" });
  await expect(failureStatus).toHaveCount(1);
  expect(
    await failureStatus.evaluate(
      (node) => node.closest('[aria-hidden="true"]') !== null
    )
  ).toBe(false);
  await page.keyboard.press("Escape");
  outage.on = false;
  outage.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(wall).toHaveAttribute("aria-busy", "true");
  // Announced from outside the busy container, or it could be held back until the busy state clears.
  await expect(
    page.getByRole("status").filter({ hasText: "Searching Again" })
  ).toBeAttached();
  // The visible action reflects the retry while the separate live region announces it.
  await expect(
    wall.getByRole("button", { name: "Searching Again" })
  ).toBeVisible();
  release();
  outage.wait = undefined;
  await expect(wall).toHaveAttribute("aria-busy", "false", { timeout: 5000 });
});

test("a tile that moves from Direct to Related glides there instead of appearing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const glides: string[] = [];
    (window as unknown as { glides: string[] }).glides = glides;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const first = (keyframes as Keyframe[])[0];
      if (first && "transform" in first && this.getAttribute("aria-label"))
        glides.push(this.getAttribute("aria-label")!);
      return animate.call(this, keyframes, options);
    };
  });
  const { memories } = await stub(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("shift");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");

  // Three Direct Matches at first; the full answer, late, takes the third to Related.
  const direct = page.getByRole("list", { name: "Direct Matches" });
  await expect(direct.getByRole("listitem")).toHaveCount(3);
  await expect(direct.getByRole("listitem")).toHaveCount(2, { timeout: 5000 });
  await expect(
    page
      .getByRole("list", { name: "Related Matches" })
      .getByRole("listitem")
      .first()
  ).toBeVisible();
  const moved = memories[2]!.title!;
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { glides: string[] }).glides)
    )
    .toContainEqual(expect.stringContaining(moved));
});

test("a PDF past the Free allowance says Partly Indexed on its tile, and no other tile does", async ({
  page,
}) => {
  await stub(page);
  const wall = page.getByRole("list", { name: "All Memories" });
  await expect(wall.getByText("Partly Indexed")).toHaveCount(1);
  await ticketShot(page, "partly-indexed");
  await expect(
    wall.getByRole("listitem", { name: /, PDF, Partly Indexed$/ })
  ).toHaveCount(1);
});

test("Show More keeps its focus while a page loads and hands it to the wall when the pages end", async ({
  page,
}) => {
  await stub(page);
  await search(page, "paged");
  const more = page.getByRole("button", { name: "Show More" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Related Matches" }).getByRole("listitem")
  ).toHaveCount(5);
  await expect(more).toHaveCount(0);
  await expect(
    page.locator('main [role="listitem"][tabindex="0"]').first()
  ).toBeFocused();
});

const shot = (page: Page, name: string, width: number, theme: string) =>
  page.screenshot({
    animations: "disabled",
    path: `${process.env.FACTORY_SCREENSHOTS_DIR}/t15-${process.env.POLISH_PHASE ?? "after"}-${name}-${width}-${theme}.png`,
  });

test("screens", async ({ page }) => {
  test.skip(!process.env.FACTORY_SCREENSHOTS_DIR, "screenshots on request");
  test.setTimeout(600_000);
  await stub(page);
  for (const [width, theme] of [
    [1440, "light"],
    [1440, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await expect(
      page.getByRole("list", { name: "All Memories" })
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await shot(page, "menu", width, theme);
    await page.getByPlaceholder("Search…").fill("harbor");
    await expect(
      page.getByRole("option", { name: /Sunset over the dock/ })
    ).toBeVisible();
    await shot(page, "menu-results", width, theme);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("list", { name: "Direct Matches" })
    ).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, "results", width, theme);
    await page.getByRole("button", { name: "Clear Search" }).first().click();

    await search(page, "zero");
    await expect(
      page.getByRole("heading", { name: "No Direct Matches" })
    ).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, "zero-direct", width, theme);
    await page.getByRole("button", { name: "Clear Search" }).first().click();

    await search(page, "nothing");
    await expect(
      page.getByRole("heading", { name: "No Memories Match" })
    ).toBeVisible();
    await shot(page, "nothing", width, theme);
    await page.getByRole("button", { name: "Clear Search" }).first().click();

    await page.keyboard.press("ControlOrMeta+k");
    await page
      .getByRole("dialog")
      .getByLabel("Query Image File")
      .setInputFiles({
        name: "q.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64"
        ),
      });
    await expect(
      page.getByRole("button", { name: /Remove Query Image/ })
    ).toBeVisible();
    await shot(page, "image-menu", width, theme);
    await page.keyboard.press("Escape");
    await shot(page, "image-wall", width, theme);
    await page.getByRole("button", { name: "Clear Search" }).first().click();
  }
});
