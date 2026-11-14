import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// 2.4.11 Focus Not Obscured, with the identity of every move asserted: a key
// that moved nothing, or moved to the wrong tile, must fail, not only one that
// leaves the focused tile under a bar. Each runs on a desktop and on a phone,
// where a sticky bar sits over the wall and the wall is one column.
const SCREENS = [
  { name: "desktop", width: 1440, height: 800 },
  { name: "phone", width: 390, height: 700 },
] as const;

const COUNT = 14;
const named = (i: number) => `Memory ${String(i).padStart(2, "0")}`;

/** Memories whose names give their place: the newest, Memory 13, leads the wall. */
async function seed(page: Page) {
  await page.evaluate(
    async ({ count }) => {
      for (let i = 0; i < count; i++)
        await fetch("/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: `Memory ${String(i).padStart(2, "0")} about lemon tarts and travel plans `.repeat(
              1 + (i % 4)
            ),
          }),
        });
    },
    { count: COUNT }
  );
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "All Memories" })
      .getByRole("listitem")
      .first()
  ).toBeVisible();
}

type Spot = {
  index: number;
  label: string;
  top: number;
  bottom: number;
  left: number;
  /** Where the sticky bar ends and the fixed Selection bar starts (or the viewport's end). */
  clearTop: number;
  clearBottom: number;
};

/** The focused tile: who it is, where it is and what may cover it. */
async function spot(page: Page): Promise<Spot> {
  return page.evaluate(() => {
    const tile = document.activeElement as HTMLElement;
    const box = tile.getBoundingClientRect();
    const sticky = document.querySelector("main > .sticky");
    const selection = document.querySelector('[aria-label="Selection"]');
    return {
      index: Number(tile.getAttribute("data-index") ?? -1),
      label: tile.getAttribute("aria-label") ?? "",
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      clearTop: sticky?.getBoundingClientRect().bottom ?? 0,
      clearBottom: selection
        ? selection.getBoundingClientRect().top
        : innerHeight,
    };
  });
}

function clear(at: Spot, message: string) {
  expect(at.top, `${message}: under the top bar`).toBeGreaterThanOrEqual(
    at.clearTop - 1
  );
  expect(at.bottom, `${message}: under the bottom`).toBeLessThanOrEqual(
    at.clearBottom + 1
  );
}

/**
 * The wall's columns as it drew them: each tile's `data-index`, grouped by the
 * lane it sits in (its x offset) and ordered by height. This is the model the
 * arrow keys walk, read from the page so the test does not share the code's
 * own arithmetic.
 */
async function wallColumns(page: Page): Promise<number[][]> {
  return page.evaluate(() => {
    const lanes = new Map<number, { index: number; y: number }[]>();
    for (const tile of document.querySelectorAll<HTMLElement>(
      'main [role="list"] > [data-index]'
    )) {
      const [x, y] = [...tile.style.transform.matchAll(/(-?[\d.]+)px/g)].map(
        (m) => Number(m[1])
      );
      const lane = lanes.get(x!) ?? [];
      lane.push({ index: Number(tile.dataset.index), y: y! });
      lanes.set(x!, lane);
    }
    return [...lanes.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tiles]) => tiles.sort((a, b) => a.y - b.y).map((t) => t.index));
  });
}

/**
 * Presses the first of `keys` that moves focus: the bottom tile of a column has
 * nothing below it, so a wall of several columns goes sideways there. Fails
 * when none moves it. Returns the tile focus landed on.
 */
async function moveByAny(page: Page, keys: string[], from: Spot) {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    if ((await spot(page)).index !== from.index)
      return move(page, key, from, true);
  }
  throw new Error(
    `None of ${keys.join(", ")} moved focus off tile ${from.index}`
  );
}

/** Presses a key and waits for focus to land on a different tile. */
async function move(page: Page, key: string, from: Spot, pressed = false) {
  if (!pressed) await page.keyboard.press(key);
  await expect
    .poll(async () => (await spot(page)).index, { message: key })
    .not.toBe(from.index);
  await expect
    .poll(
      async () => {
        const now = await spot(page);
        return now.top >= now.clearTop - 1 && now.bottom <= now.clearBottom + 1;
      },
      { message: `${key} into view` }
    )
    .toBe(true);
  return spot(page);
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test("arrow keys land on the expected tile, in view", async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await seed(page);
      const wall = page.getByRole("list", { name: "All Memories" });
      await wall.getByRole("listitem").first().focus();
      let at = await spot(page);
      expect(at.label.startsWith(named(COUNT - 1))).toBe(true);

      if (screen.name === "phone") {
        // One column: the tile below is the next one, the tile above the last.
        for (let k = 1; k < COUNT; k++) {
          at = await move(page, "ArrowDown", at);
          expect(at.index, `ArrowDown ${k}`).toBe(k);
          expect(at.label.startsWith(named(COUNT - 1 - k))).toBe(true);
          clear(at, `ArrowDown ${k}`);
        }
        for (let k = COUNT - 2; k >= 0; k--) {
          at = await move(page, "ArrowUp", at);
          expect(at.index, `ArrowUp to ${k}`).toBe(k);
          expect(at.label.startsWith(named(COUNT - 1 - k))).toBe(true);
          clear(at, `ArrowUp to ${k}`);
        }
        return;
      }

      // Several columns: the neighbour is in the lane beside or below, and the
      // opposite key comes back to the tile it left.
      const origin = at;
      const right = await move(page, "ArrowRight", origin);
      expect(right.left).toBeGreaterThan(origin.left);
      const down = await move(page, "ArrowDown", right);
      expect(down.top).toBeGreaterThan(right.top);
      const up = await move(page, "ArrowUp", down);
      expect(up.index).toBe(right.index);
      const left = await move(page, "ArrowLeft", up);
      expect(left.index).toBe(origin.index);
      // Down the longest column, tile by tile. The expected order is read
      // from where the wall drew its tiles (same lane, by height), before any
      // key is pressed, so a skipped neighbour or an early stop fails.
      const columns = await wallColumns(page);
      expect(
        columns.flat().length,
        "every tile is drawn, so the column model is whole"
      ).toBe(COUNT);
      const column = columns.reduce((a, b) => (b.length > a.length ? b : a));
      expect(column.length, "a column worth walking").toBeGreaterThanOrEqual(3);
      await page.locator(`main [data-index="${column[0]}"]`).focus();
      let here = await spot(page);
      expect(here.index).toBe(column[0]);
      for (let k = 1; k < column.length; k++) {
        await page.keyboard.press("ArrowDown");
        await expect
          .poll(async () => (await spot(page)).index, {
            message: `ArrowDown ${k} lands on tile ${column[k]}`,
          })
          .toBe(column[k]);
        here = await spot(page);
        expect(here.label.startsWith(named(COUNT - 1 - column[k]!))).toBe(true);
        clear(here, `column ArrowDown ${k}`);
      }
      // The last tile of the column has nothing below it: focus stays.
      expect(here.index).toBe(column.at(-1));
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      expect((await spot(page)).index, "ArrowDown at the column's end").toBe(
        column.at(-1)
      );
      // And back up, each step to the tile it came from, to the first.
      for (let k = column.length - 2; k >= 0; k--) {
        await page.keyboard.press("ArrowUp");
        await expect
          .poll(async () => (await spot(page)).index, {
            message: `ArrowUp to tile ${column[k]}`,
          })
          .toBe(column[k]);
        clear(await spot(page), `column ArrowUp to ${k}`);
      }
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(300);
      expect((await spot(page)).index, "ArrowUp at the column's start").toBe(
        column[0]
      );
    });

    test("Space and Shift+arrows select what the focus crosses", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await seed(page);
      const wall = page.getByRole("list", { name: "All Memories" });
      const bar = page.getByRole("region", { name: "Selection", exact: true });
      const selected = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("[data-index][data-selected]")]
            .map((tile) => Number(tile.getAttribute("data-index")))
            .sort((a, b) => a - b)
        );
      await wall.getByRole("listitem").first().focus();
      let at = await spot(page);
      // Space selects the focused tile and only it.
      await page.keyboard.press("Space");
      await expect(bar).toContainText("1 Selected");
      expect(await selected()).toEqual([at.index]);
      expect((await spot(page)).index).toBe(at.index);
      clear(await spot(page), "Space");

      // Shift+arrow extends the selection over every tile in wall order
      // between the first and the one focus lands on.
      const anchor = at.index;
      for (let step = 0; step < 4; step++) {
        at = await moveByAny(page, ["Shift+ArrowDown", "Shift+ArrowRight"], at);
        const expected = Array.from(
          { length: Math.abs(at.index - anchor) + 1 },
          (_, i) => Math.min(anchor, at.index) + i
        );
        await expect(bar).toContainText(`${expected.length} Selected`);
        expect(await selected(), `Shift+ArrowDown ${step + 1}`).toEqual(
          expected
        );
        expect(at.label.endsWith("Selected")).toBe(true);
        clear(at, `Shift+ArrowDown ${step + 1}`);
      }
      // Back up shrinks it to the tile focus returns to.
      at = await moveByAny(page, ["Shift+ArrowUp", "Shift+ArrowLeft"], at);
      const shrunk = Array.from(
        { length: Math.abs(at.index - anchor) + 1 },
        (_, i) => Math.min(anchor, at.index) + i
      );
      expect(await selected()).toEqual(shrunk);
      clear(at, "Shift+ArrowUp");

      // A plain arrow moves focus and leaves the selection alone.
      const before = await selected();
      const moved = await moveByAny(page, ["ArrowDown", "ArrowRight"], at);
      expect(await selected()).toEqual(before);
      expect(moved.index).not.toBe(at.index);
      clear(moved, "ArrowDown with a selection");

      // ⌘A takes every Memory, Escape lets go.
      await page.keyboard.press("Control+a");
      await expect(bar).toContainText(`${COUNT} Selected`);
      await page.keyboard.press("Escape");
      await expect(bar).toHaveCount(0);
      expect(await selected()).toEqual([]);
    });
  });
}

// Direct above Related, one wall each: ↓ from a Direct tile with nothing
// below it lands on the first Related tile, ↑ from the first Related tile
// lands on the last Direct tile, whichever column either sits in.
const TITLES = [
  "Sunset over the dock",
  "Cardamom buns with orange zest",
  "Notes from the harbor walk",
  "Lemon tart with a short crust",
  "A recipe for plum jam",
  "Packing list for Lisbon",
  "Winter sourdough schedule",
  "Ideas for the garden shed",
];
const DIRECT = 5;

async function stubSearch(page: Page) {
  await page.request.post("/api/memories", {
    headers: { origin: new URL(page.url()).origin },
    data: { id: crypto.randomUUID(), body: "base", captureNote: null },
  });
  const {
    memories: [base],
  } = (await (await page.request.get("/api/memories")).json()) as {
    memories: Record<string, unknown>[];
  };
  const memories = TITLES.map((title, i) => ({
    ...base,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    kind: "text",
    title,
    body: `${title}. `.repeat(3 + i * 2),
    sourceUrl: null,
    capturedAt: new Date(Date.now() - i * 60_000).toISOString(),
    lastSavedAt: new Date(Date.now() - i * 60_000).toISOString(),
    indexState: "searchable",
    indexError: null,
    categories: [],
    hasVectors: true,
    aiOptOut: false,
  }));
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { memories, unfinished: [] } })
      : route.fallback()
  );
  await page.route("**/api/search", (route) => {
    const body = route.request().postDataJSON() as { mode: string };
    return route.fulfill({
      json: {
        mode: body.mode === "instant" ? "instant" : "full",
        results: memories.map((m, i) => ({
          id: m.id,
          match: i < DIRECT ? "direct" : "related",
          part: { kind: "field", field: "title" },
        })),
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible();
}

/** The tile focus is on: its title, and the wall it is in. */
async function onTile(page: Page) {
  return page.evaluate(() => {
    const tile = document.activeElement as HTMLElement;
    return {
      label: tile.getAttribute("aria-label") ?? "",
      wall: tile.closest("[role=list]")?.getAttribute("aria-label") ?? "",
    };
  });
}

for (const screen of SCREENS) {
  test(`↓ and ↑ cross between Direct and Related Matches, ${screen.name}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await signIn(page);
    await stubSearch(page);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search…").fill("harbor");
    await expect(page.getByRole("option", { name: /^harbor/ })).toBeVisible();
    await page.keyboard.press("Enter");
    const direct = page.getByRole("list", { name: "Direct Matches" });
    const related = page.getByRole("list", { name: "Related Matches" });
    await expect(direct.getByRole("listitem")).toHaveCount(DIRECT);
    await expect(related.getByRole("listitem")).toHaveCount(
      TITLES.length - DIRECT
    );

    // Enter put focus on the first Direct tile.
    await expect(direct.getByRole("listitem").first()).toBeFocused();
    expect((await onTile(page)).label.startsWith(TITLES[0]!)).toBe(true);

    // ↓ until focus leaves the Direct wall: every stop on the way is Direct,
    // and the one it leaves for is the first Related tile.
    const seen: string[] = [];
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      const now = await onTile(page);
      if (now.wall === "Related Matches") {
        expect(now.label.startsWith(TITLES[DIRECT]!)).toBe(true);
        break;
      }
      expect(now.wall).toBe("Direct Matches");
      seen.push(now.label);
      if (step === 11) throw new Error("↓ never reached the Related wall");
    }
    await expect(related.getByRole("listitem").first()).toBeFocused();
    const landed = await spot(page);
    clear(landed, "first Related tile");

    // ↑ from there goes back to the last Direct tile, in view.
    await page.keyboard.press("ArrowUp");
    await expect(
      direct.getByRole("listitem", {
        name: new RegExp(`^${TITLES[DIRECT - 1]}`),
      })
    ).toBeFocused();
    clear(await spot(page), "last Direct tile");

    // And once more down: the same first Related tile again.
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      if ((await onTile(page)).wall === "Related Matches") break;
    }
    await expect(
      related.getByRole("listitem", { name: new RegExp(`^${TITLES[DIRECT]}`) })
    ).toBeFocused();
  });
}
