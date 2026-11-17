import { expect, test, type Locator, type Page } from "@playwright/test";
import { settle } from "./a11y-support";
import { signIn } from "./sign-in";

// Round 1, stream C: Memory detail and the viewers. Each test checks a
// contract at the widths where it broke (1440, 390, 320, and 200% text).
// Screenshots go to R1_C_OUT when it is set.

test.setTimeout(120_000);

const OUT = process.env.R1_C_OUT;
const shot = async (page: Page, name: string) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
};
const THEMES = ["light", "dark"] as const;

async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

/** Gives every Memory of `kind` the fields a gathered one would have. */
async function decorate(
  page: Page,
  kind: string,
  extra: Record<string, unknown>
) {
  await page.route("**/api/memories*", async (route) => {
    const response = await route.fetch();
    if (route.request().method() !== "GET") return route.fulfill({ response });
    const data = await response.json();
    const apply = (m: Record<string, unknown>) =>
      m.kind === kind ? { ...m, indexState: "searchable", ...extra } : m;
    await route.fulfill({
      response,
      json: Array.isArray(data.memories)
        ? { ...data, memories: data.memories.map(apply) }
        : Array.isArray(data)
          ? data.map(apply)
          : apply(data),
    });
  });
}

const overflows = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );

const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

/** No two of these boxes share any area. */
async function disjoint(locators: Locator[]) {
  const boxes = await Promise.all(locators.map(boxOf));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5;
      expect(apart, `controls ${i} and ${j} overlap`).toBe(true);
    }
}

/** Larger text, as a person who zoomed to 200% sees it. */
const zoom = (page: Page) =>
  page.evaluate(() => (document.documentElement.style.fontSize = "200%"));

test("Memory detail is a sheet on a phone and a centred dialog on a desktop, in one scroll region", async ({
  page,
}) => {
  await signIn(page);
  await paste(page, "Cardamom buns with orange zest");
  const tile = page.getByRole("listitem", { name: /Cardamom buns/ });
  await expect(tile).toBeVisible();

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [320, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await tile.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await settle(page);
      const box = await boxOf(dialog);
      if (width < 640) {
        // Bottom-aligned, full width, never taller than 92% of the screen.
        expect(box.x).toBe(0);
        expect(Math.round(box.width)).toBe(width);
        expect(Math.round(box.y + box.height)).toBe(height);
        expect(box.height).toBeLessThanOrEqual(height * 0.92 + 1);
      } else {
        expect(box.width).toBeLessThanOrEqual(672 + 1);
        expect(Math.round(box.x + box.width / 2)).toBe(width / 2);
        expect(box.y).toBeGreaterThan(0);
      }
      // Close and Done are both on screen with the footer always visible.
      for (const name of width < 640 ? ["Close", "Done"] : ["Close"]) {
        const button = dialog.getByRole("button", { name, exact: true });
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      // The body is the one scrolling region.
      const scrollers = await dialog.evaluate(
        (root) =>
          [...root.querySelectorAll("*")].filter((el) => {
            const overflow = getComputedStyle(el).overflowY;
            return (
              (overflow === "auto" || overflow === "scroll") &&
              !el.matches("textarea")
            );
          }).length
      );
      expect(scrollers).toBe(1);
      await expect(
        dialog.getByRole("switch", { name: "AI Opt-Out" })
      ).toBeVisible();
      await dialog.getByRole("button", { name: "More", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "Delete" })
      ).toBeVisible();
      await page.keyboard.press("Escape");
      expect(await overflows(page)).toBe(false);
      await shot(page, `detail-text-${theme}-${width}`);
      // Close, by its button, hands focus back to the Memory it opened from.
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toBeHidden();
      await expect(tile).toBeFocused();
    }
  }
});

test("a note reads as text until touched: no chrome at rest, one line for one line, 96px once you write and no shift when you leave", async ({
  page,
}) => {
  await signIn(page);
  await paste(page, "Short note");
  const tile = page.getByRole("listitem", { name: /Short note/ });
  await tile.click();
  const dialog = page.getByRole("dialog");
  const text = dialog.getByRole("textbox", { name: "Text" });
  const chrome = () =>
    text.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        border: s.borderTopWidth,
        // Focus is the text field's 2px ink edge (an inset shadow), not an outline.
        outline:
          s.outlineStyle !== "none"
            ? s.outlineWidth
            : s.boxShadow.includes("inset")
              ? "2px"
              : "0px",
      };
    });
  // At rest: nothing drawn, and as tall as its one line (24px + 12px inset twice).
  expect(await chrome()).toEqual({
    background: "rgba(0, 0, 0, 0)",
    border: "1px",
    outline: "0px",
  });
  const rest = (await boxOf(text)).height;
  expect(rest).toBeLessThan(60);
  // Base text on a 24px leading, 12px inset on every side.
  expect(
    await text.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontSize, s.lineHeight, s.paddingLeft, s.paddingTop];
    })
  ).toEqual(["15px", "24px", "12px", "12px"]);
  // Hover draws the surface, by colour alone (120ms), never a size or an edge.
  expect(
    await text.evaluate((el) => getComputedStyle(el).transitionProperty)
  ).toBe("background-color");
  await text.hover();
  await expect
    .poll(async () => (await chrome()).background)
    .not.toBe("rgba(0, 0, 0, 0)");
  expect((await chrome()).border).toBe("1px");
  expect((await boxOf(text)).height).toBe(rest);
  // Tab reaches it with a visible ring, and only then does it open to 96px.
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(text).toBeFocused();
  expect((await chrome()).outline).toBe("2px");
  expect((await boxOf(text)).height).toBeGreaterThanOrEqual(96);
  expect((await boxOf(text)).height).toBeLessThanOrEqual(100);
  // Typing grows it with no height transition.
  await text.fill(Array.from({ length: 12 }, (_, i) => `Line ${i}`).join("\n"));
  expect((await boxOf(text)).height).toBeGreaterThan(250);
  // Leaving it moves nothing: Done is where it was when the press began, so
  // pressing it straight after typing (focus still in the field) lands.
  await text.fill("Line 0");
  const done = dialog.getByRole("button", { name: "Close", exact: true });
  const before = await boxOf(done);
  await dialog.getByRole("textbox", { name: "Capture Note" }).focus();
  expect(await boxOf(done)).toEqual(before);
  expect((await boxOf(text)).height).toBeGreaterThanOrEqual(96);
  await text.fill("Line 0\nLine 11");
  // Press Done with the field still focused: it closes on that one press.
  await done.click();
  await expect(dialog).toBeHidden();
  await page.getByRole("listitem", { name: /Line 0/ }).click();
  const reopened = dialog.getByRole("textbox", { name: "Text" });
  await expect(reopened).toHaveValue("Line 0\nLine 11");
  // A fresh open reads as text again: two lines (24px each) and the inset.
  expect((await boxOf(reopened)).height).toBeLessThan(96);
  await reopened.focus();
  // Ctrl Enter saves and closes, and focus goes back to the Memory.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listitem", { name: /Line 0/ })).toBeFocused();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json())
    .toMatchObject({
      memories: [{ body: expect.stringContaining("Line 11") }],
    });
});

test("a toast never covers Done on a phone sheet: it moves to the top, clear of the footer, and both stay clickable", async ({
  page,
}) => {
  await signIn(page);
  for (const [width, height, large] of [
    [390, 844, false],
    [320, 640, false],
    [320, 640, true],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (large) await zoom(page);
    await paste(page, `Toast check ${width} ${large}`);
    const tile = page.getByRole("listitem", {
      name: new RegExp(`Toast check ${width} ${large}`),
    });
    await expect(tile).toBeVisible();
    // The "Captured" toast with Undo is up while the detail opens.
    // One toast shows at a time on a phone: the front one is the newest.
    const toast = page.locator("[data-sonner-toast][data-front=true]");
    await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
    await tile.click();
    const dialog = page.getByRole("dialog");
    const done = dialog.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeVisible();
    await settle(page);
    await expect(toast).toBeVisible();
    // The toast stands at the top while a sheet is open, never over the footer.
    const footer = await boxOf(dialog.locator("[data-slot=dialog-footer]"));
    const stood = await boxOf(toast);
    expect(stood.y + stood.height).toBeLessThanOrEqual(footer.y + 0.5);
    // What the finger would hit at the centre of each is that control.
    const hit = async (name: string, scope: Locator) => {
      const target = scope.getByRole("button", { name, exact: true });
      const box = await boxOf(target);
      return target.evaluate(
        (el, [x, y]) => {
          const top = document.elementFromPoint(x!, y!);
          return !!top && (el === top || el.contains(top));
        },
        [box.x + box.width / 2, box.y + box.height / 2]
      );
    };
    expect(await hit("Done", dialog)).toBe(true);
    expect(await hit("Undo", toast)).toBe(true);
    await shot(page, `detail-toast-${width}${large ? "-200" : ""}`);
    await done.click();
    await expect(dialog).toBeHidden();
    if (large)
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  }
});

test("a long Title reads in full at 320px and at 200% text, and Done is never an orphan row", async ({
  page,
}) => {
  await signIn(page);
  await paste(page, "Body of a Memory with an uncomfortably long title");
  const tile = page.getByRole("listitem", { name: /Body of a Memory/ });
  await tile.click();
  const dialog = page.getByRole("dialog");
  const title = dialog.getByRole("textbox", { name: "Title" });
  await title.fill(
    "A very long title that goes on and on, with Unbreakable-Compound-Words-And-A-Link https://example.com/x/y/z"
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    for (const text of ["100%", "200%"]) {
      await page.evaluate(
        (size) => (document.documentElement.style.fontSize = size),
        text
      );
      // The field grew to show it all: no inner scrolling, none cut off.
      expect(
        await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
      ).toBe(true);
      expect(await overflows(page)).toBe(false);
      await expect(
        dialog.getByRole("button", { name: "Done", exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "Close" })
      ).toBeInViewport({ ratio: 1 });
      await shot(page, `detail-title-${width}-${text === "200%" ? 200 : 100}`);
    }
  }
});

test("a link reads as one body at base size, with the Source above it", async ({
  page,
}) => {
  await signIn(page);
  await decorate(page, "link", {
    pageTitle: "Slow Cooking Notes",
    body:
      "First paragraph of the page.\n\nSecond paragraph of the page.\n\n" +
      Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 3}`).join("\n\n"),
  });
  await paste(page, "https://example.com/slow-cooking");
  await expect(
    page.getByRole("listitem", { name: /Slow Cooking Notes/ })
  ).toBeVisible();
  await page.reload();
  await page.getByRole("listitem", { name: /Slow Cooking Notes/ }).click();
  const dialog = page.getByRole("dialog");
  const article = dialog.getByRole("article", { name: "Text" });
  await expect(article).toBeVisible();
  expect(
    await article.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontSize, s.lineHeight, s.overflowY];
    })
  ).toEqual(["15px", "24px", "visible"]);
  // The Source sits above the text, and the body (not the article) scrolls.
  const link = dialog.getByRole("link", { name: /example\.com/ });
  expect((await boxOf(link)).y).toBeLessThan((await boxOf(article)).y);
  const body = dialog.locator("[data-slot=dialog-body]");
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true
  );
  // Focus opens on the body, so the keyboard scrolls the reading at once.
  await expect(body).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await shot(page, "detail-link-1440");
});

test("a video plays only after Play, and says unavailable and over the limit as two labels", async ({
  page,
}) => {
  await signIn(page);
  await decorate(page, "video", {
    pageTitle: "Long Lecture",
    video: { transcriptState: "over_allowance", transcript: [] },
  });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/youtube|ytimg|googlevideo/.test(r.url())) requests.push(r.url());
  });
  await paste(page, "https://youtu.be/abcdefghijk?t=95");
  await expect(
    page.getByRole("listitem", { name: /Long Lecture/ })
  ).toBeVisible();
  await page.reload();
  await page.getByRole("listitem", { name: /Long Lecture/ }).click();
  const dialog = page.getByRole("dialog");
  const play = dialog.getByRole("button", {
    name: "Play From 1:35",
    exact: true,
  });
  await expect(play).toBeVisible();
  // A flat 16:9 panel with a target of at least 44px, and no network yet.
  const box = await boxOf(play);
  expect(box.height).toBe(64);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(requests).toEqual([]);
  await expect(dialog.locator("iframe")).toHaveCount(0);
  // Two compact labels, not a sentence.
  const status = dialog.getByRole("status").filter({ hasText: "Transcript" });
  await expect(status.locator("span")).toHaveText([
    "Transcript Unavailable",
    "Over 60 Minutes",
  ]);
  await expect(
    dialog.getByText(/,/).filter({ hasText: "Over 60" })
  ).toHaveCount(0);
  await shot(page, "detail-video-over-limit-1440");
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Player</title>" })
  );
  await play.click();
  await expect(
    dialog.locator("iframe[title='YouTube Player']")
  ).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/abcdefghijk?start=95"
  );
});

// ---------- viewers ----------

/** A small real PDF, one page per text. */
function pdfOf(pages: string[]) {
  const objects: string[] = [];
  const font = 3 + pages.length * 2;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`
  );
  pages.forEach((text, i) => {
    const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

async function dropPdf(page: Page, name: string, pages: string[]) {
  await page.evaluate(
    ({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        window.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true })
        );
      }
    },
    { name, text: pdfOf(pages) }
  );
}

async function dropImage(page: Page, colour = "#2f6fe0") {
  await page.evaluate(async (colour) => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext("2d")!;
    context.fillStyle = colour;
    context.fillRect(0, 0, 64, 48);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([png], "square.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      window.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true })
      );
    }
  }, colour);
}

/** Drops one image per colour and waits until each is stored and Searchable. */
async function captureImages(page: Page, colours: string[]) {
  const tiles = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem", { name: /^(Image|Fake Image Title)/ });
  for (const [i, colour] of colours.entries()) {
    await dropImage(page, colour);
    await expect(tiles).toHaveCount(i + 1);
    await expect(tiles.first().getByRole("progressbar")).toBeHidden({
      timeout: 15_000,
    });
  }
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get("/api/memories")).json()) as {
            memories: { indexState: string }[];
          }
        ).memories.every((m) => m.indexState === "searchable"),
      { timeout: 25_000 }
    )
    .toBe(true);
  await page.reload();
  await expect(tiles).toHaveCount(colours.length);
  return tiles;
}

/** The bar's controls, left to right, and Close at the end. */
async function toolbarControls(viewer: Locator) {
  const bar = viewer.locator("[data-slot=viewer-bar]");
  return bar.locator(
    "button:visible, a:visible, [role=switch]:visible, summary:visible"
  );
}

test("the PDF viewer's toolbar never overlaps at 320px or 200% text, Close returns focus to the Memory, and a failed page can be retried", async ({
  page,
}) => {
  await signIn(page);
  await dropPdf(page, "Allotment rules.pdf", [
    "Welcome to the allotment",
    "Plots are mowed on Tuesdays",
    "Compost bins stay by the shed",
  ]);
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem", { name: "Allotment rules, PDF" });
  await expect(tile).toBeVisible();
  await expect(tile.getByRole("progressbar")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 20_000,
    })
    .toMatchObject({ memories: [{ kind: "pdf", indexState: "searchable" }] });
  await page.reload();

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [width, height, large] of [
      [1440, 900, false],
      [390, 844, false],
      [320, 640, false],
      [320, 640, true],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (large) await zoom(page);
      await tile.click();
      const viewer = page.getByRole("dialog");
      await expect(viewer.getByRole("img", { name: "Page 1" })).toBeVisible();
      const open = viewer.getByRole("link", { name: "Open PDF" });
      await expect(open).toBeVisible();
      const controls = await toolbarControls(viewer);
      const all = await controls.all();
      await disjoint(all);
      // Close sits at the right edge, clear of every control.
      const close = viewer.getByRole("button", { name: "Close" });
      await disjoint([...all, close]);
      for (const control of [...all, close]) {
        const b = await boxOf(control);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
      }
      // The pages start under the bar, never behind it.
      const bar = await boxOf(viewer.locator("[data-slot=viewer-bar]"));
      const pages = await boxOf(viewer.getByLabel("Pages"));
      expect(pages.y).toBeGreaterThanOrEqual(bar.y + bar.height - 0.5);
      expect(await overflows(page)).toBe(false);
      await shot(page, `pdf-${theme}-${width}${large ? "-200" : ""}`);
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      if (large)
        await page.evaluate(
          () => (document.documentElement.style.fontSize = "")
        );
    }
  }

  // Close, by its button, hands focus back to the PDF's tile.
  await page.setViewportSize({ width: 1440, height: 900 });
  await tile.click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(tile).toBeFocused();

  // A page whose image will not load keeps its sheet, its Page N name and a
  // Try Again that fetches it again.
  await page.setViewportSize({ width: 1440, height: 900 });
  let blocked = true;
  await page.route(/\/r1-c-page-(\d+)\.svg/, (route) =>
    blocked && /page-1\.svg/.test(route.request().url())
      ? route.abort()
      : route.fulfill({
          contentType: "image/svg+xml",
          body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"><rect width="612" height="792" fill="#fff"/></svg>`,
        })
  );
  await page.route("**/api/memories/*/pages", (route) =>
    route.fulfill({
      json: {
        pages: [1, 2, 3].map((n) => ({
          page: n,
          url: `/r1-c-page-${n}.svg`,
          width: 612,
          height: 792,
        })),
      },
    })
  );
  await tile.click();
  const viewer = page.getByRole("dialog");
  const failed = viewer.locator("[data-failed]").first();
  await expect(failed).toBeVisible();
  const sheet = await boxOf(failed);
  expect(sheet.height).toBeGreaterThan(300);
  await expect(viewer.getByRole("img", { name: "Page 1" })).toBeVisible();
  await shot(page, "pdf-failed-page-1440");
  blocked = false;
  await viewer.getByRole("button", { name: "Try Again on Page 1" }).click();
  await expect(viewer.locator("[data-failed]")).toHaveCount(0);
  await expect(viewer.getByRole("img", { name: "Page 1" })).toBeVisible();
});

test("the image viewer's toolbar never overlaps at 320px or 200% text, and Escape returns focus to the Memory", async ({
  page,
}) => {
  await signIn(page);
  await dropImage(page);
  const tile = page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem", { name: /^(Image|Fake Image Title)/ });
  await expect(tile).toBeVisible();
  await expect(tile.getByRole("progressbar")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 20_000,
    })
    .toMatchObject({ memories: [{ kind: "image", indexState: "searchable" }] });
  await page.reload();
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [width, height, large] of [
      [1440, 900, false],
      [390, 844, false],
      [320, 640, false],
      [320, 640, true],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (large) await zoom(page);
      await tile.click();
      const viewer = page.getByRole("dialog");
      const picture = viewer.locator("img[alt]:not([alt=''])");
      await expect(picture).toBeVisible();
      const all = await (await toolbarControls(viewer)).all();
      await disjoint(all);
      const close = viewer.getByRole("button", { name: "Close" });
      await disjoint([...all, close]);
      for (const control of [...all, close]) {
        const b = await boxOf(control);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
      }
      // The image fits under the bar and above the step buttons.
      const bar = await boxOf(viewer.locator("[data-slot=viewer-bar]"));
      const image = await boxOf(picture);
      expect(image.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
      expect(image.y + image.height).toBeLessThanOrEqual(height + 1);
      expect(image.x).toBeGreaterThanOrEqual(0);
      expect(image.x + image.width).toBeLessThanOrEqual(width + 1);
      expect(await overflows(page)).toBe(false);
      await shot(page, `image-${theme}-${width}${large ? "-200" : ""}`);
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(tile).toBeFocused();
      if (large)
        await page.evaluate(
          () => (document.documentElement.style.fontSize = "")
        );
    }
  }
});

const stageImage = (viewer: Locator) =>
  viewer.locator("img[alt]:not([alt=''])");

test("the image viewer moves between images by arrow, button and swipe, stops at the ends, and Close returns focus", async ({
  page,
}) => {
  await signIn(page);
  const tiles = await captureImages(page, ["#2f6fe0", "#e0502f", "#2fe08a"]);
  await tiles.first().click();
  const viewer = page.getByRole("dialog");
  const src = async () =>
    (await stageImage(viewer).last().getAttribute("src")) ?? "";
  await expect(stageImage(viewer)).toHaveCount(1);
  const seen = [await src()];
  const next = viewer.getByRole("button", { name: "Next Image" });
  const previous = viewer.getByRole("button", { name: "Previous Image" });
  await expect(previous).toBeHidden();

  // → and the Next button go on; each image is a different Memory's file.
  await page.keyboard.press("ArrowRight");
  await expect.poll(src).not.toBe(seen[0]);
  seen.push(await src());
  await next.click();
  await expect.poll(src).not.toBe(seen[1]);
  seen.push(await src());
  expect(new Set(seen).size).toBe(3);
  // The last image: Next is disabled but stays focusable, and → does nothing.
  await expect(next).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  expect(await src()).toBe(seen[2]);

  // ← and Previous come back the same way.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(src).toBe(seen[1]);
  await previous.click();
  await expect.poll(src).toBe(seen[0]);
  await expect(previous).toBeHidden();

  // A swipe left goes on, a swipe right comes back (past 120px).
  await settle(page);
  const swipe = async (from: number, to: number) => {
    const y = 450;
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move((from + to) / 2, y, { steps: 4 });
    await page.mouse.move(to, y, { steps: 4 });
    await page.mouse.up();
  };
  await swipe(900, 300);
  await expect.poll(src).toBe(seen[1]);
  await settle(page);
  await swipe(300, 900);
  await expect.poll(src).toBe(seen[0]);
  // A short drag is not a swipe: it springs back to the same image.
  await settle(page);
  await swipe(700, 640);
  await page.waitForTimeout(400);
  expect(await src()).toBe(seen[0]);

  // Close, by its button, hands focus to the image last shown (the second).
  await page.keyboard.press("ArrowRight");
  await expect.poll(src).toBe(seen[1]);
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await expect(tiles.nth(1)).toBeFocused();
});

test("with reduced motion an image change does not slide, and without it the image comes in from the side", async ({
  page,
}) => {
  await signIn(page);
  const tiles = await captureImages(page, ["#2f6fe0", "#e0502f"]);
  /** How far the incoming image is from centre two frames after ArrowRight. */
  const offsetAfterNext = async () => {
    const viewer = page.getByRole("dialog");
    return viewer.evaluate(async (root) => {
      const pictures = () => [
        ...root.querySelectorAll<HTMLImageElement>("img[alt]:not([alt=''])"),
      ];
      const before = pictures().map((img) => img.src);
      root.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
      for (let i = 0; i < 3; i++)
        await new Promise((r) => requestAnimationFrame(r));
      const incoming = pictures().find((img) => !before.includes(img.src));
      if (!incoming) return Infinity;
      const box = incoming.getBoundingClientRect();
      return Math.abs(box.x + box.width / 2 - window.innerWidth / 2);
    });
  };
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tiles.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await settle(page);
  expect(await offsetAfterNext()).toBeGreaterThan(40);
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await tiles.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await settle(page);
  expect(await offsetAfterNext()).toBeLessThan(2);
  // The new image is there and readable, and Escape still closes.
  await expect(stageImage(page.getByRole("dialog")).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("coarse pointers get 44px targets in the detail and in both viewers", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  /** Every button, link and summary in `scope` is at least 44px each way. */
  const touchSized = async (scope: Locator, what: string) => {
    // A switch's 44px hit area is a pseudo-element (shared Switch, A's); its
    // visible box is 20px, so it is judged by Playwright's own hit-testing.
    const controls = await scope
      .locator("button:visible:not([role=switch]), a:visible, summary:visible")
      .all();
    expect(controls.length, what).toBeGreaterThan(0);
    for (const control of controls) {
      const b = await boxOf(control);
      const name =
        (await control.getAttribute("aria-label")) ??
        ((await control.innerText()) || (await control.textContent())) ??
        "";
      expect(
        Math.round(b.height),
        `${what}: ${name} height`
      ).toBeGreaterThanOrEqual(44);
      // Icon buttons are square; text buttons are as wide as their words.
      if (!(await control.innerText()).trim())
        expect(
          Math.round(b.width),
          `${what}: ${name} width`
        ).toBeGreaterThanOrEqual(44);
    }
  };
  try {
    await signIn(page);
    await paste(page, "Touch target check");
    await captureImages(page, ["#2f6fe0", "#e0502f"]);
    await dropPdf(page, "Touch rules.pdf", ["One", "Two"]);
    const wall = page.getByRole("list", { name: "All Memories" });
    const pdf = wall.getByRole("listitem", { name: "Touch rules, PDF" });
    await expect(pdf).toBeVisible();
    await expect(pdf.getByRole("progressbar")).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get("/api/memories")).json()) as {
              memories: { kind: string; indexState: string }[];
            }
          ).memories.some(
            (m) => m.kind === "pdf" && m.indexState === "searchable"
          ),
        { timeout: 25_000 }
      )
      .toBe(true);
    await page.reload();

    await wall.getByRole("listitem", { name: /Touch target check/ }).tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await touchSized(dialog, "Memory detail");
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toBeHidden();

    await wall.getByRole("listitem", { name: "Touch rules, PDF" }).tap();
    await expect(dialog.getByRole("img", { name: "Page 1" })).toBeVisible();
    await touchSized(dialog, "PDF viewer");
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toBeHidden();

    await wall
      .getByRole("listitem", { name: /^(Image|Fake Image Title)/ })
      .first()
      .tap();
    await expect(stageImage(dialog)).toBeVisible();
    await touchSized(dialog, "Image viewer");
  } finally {
    await context.close();
  }
});

test("detail Delete in More offers Undo and viewer AI Opt-Out is checked in More", async ({
  page,
}) => {
  await signIn(page);
  await paste(page, "Memory to delete and restore");
  const tile = page.getByRole("listitem", {
    name: /Memory to delete and restore/,
  });
  await tile.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(tile).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(tile).toBeVisible();
  const images = await captureImages(page, ["#2f6fe0"]);
  await images.first().click();
  const viewer = page.getByRole("dialog");
  await viewer.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "AI Opt-Out" }).click();
  await viewer.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "AI Opt-Out" })
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(images.first()).toBeFocused();
});
