import { expect, test, type Page } from "@playwright/test";
import { paste } from "./a11y-support";
import { fromOwnAddress, signIn, stubTurnstile } from "./sign-in";

// Round 1, stream A: the shared foundation and shell. Each test checks one
// contract another stream builds on (sign-in, toast, dialog, search row,
// phone menu). Screenshots go to R1_A_OUT when it is set.

const OUT = process.env.R1_A_OUT;
const shot = async (page: Page, name: string) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
};

const THEMES = ["light", "dark"] as const;
const WIDTHS = [320, 390] as const;

/** True when the page scrolls sideways. */
const overflows = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`sign-in: wordmark, form and code fit ${width}px, ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 800 });
      await stubTurnstile(page);
      await fromOwnAddress(page);
      await page.goto("/sign-in");
      await expect(
        page.getByRole("heading", { name: "Sign In to Spark", level: 1 })
      ).toBeVisible();
      // The wordmark is display xl, 24px above the heading.
      const wordmark = page.getByText("Spark", { exact: true }).first();
      expect(
        await wordmark.evaluate((el) => getComputedStyle(el).fontSize)
      ).toBe("28px");
      const gap = await page.evaluate(() => {
        const mark = [...document.querySelectorAll("p")].find(
          (p) => p.textContent === "Spark"
        )!;
        const heading = document.querySelector("h1")!;
        return (
          heading.getBoundingClientRect().top -
          mark.getBoundingClientRect().bottom
        );
      });
      expect(Math.round(gap)).toBe(24);
      expect(await overflows(page)).toBe(false);
      await shot(page, `sign-in-email-${theme}-${width}`);

      // A bad address says so in Title Case, tied to the field.
      const email = page.getByRole("textbox", { name: "Email" });
      await email.fill("not-an-email");
      await page.getByRole("button", { name: "Continue with Email" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText("Invalid Email Address");
      await expect(email).toHaveAttribute("aria-invalid", "true");
      const described = await email.getAttribute("aria-describedby");
      await expect(page.locator(`#${described}`)).toHaveText(
        "Invalid Email Address"
      );

      await email.fill(`probe-${Date.now()}@example.com`);
      await page.getByRole("button", { name: "Continue with Email" }).click();
      await expect(
        page.getByRole("heading", { name: "Check Your Email" })
      ).toBeVisible();
      expect(await overflows(page)).toBe(false);
      // Six equal slots with equal gaps that fill the form's width.
      const slots = await page
        .locator("[data-slot=input-otp-slot]")
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { left: r.left, right: r.right, width: r.width };
          })
        );
      expect(slots).toHaveLength(6);
      const widths = new Set(slots.map((s) => Math.round(s.width)));
      expect(widths.size).toBe(1);
      const gaps = slots
        .slice(1)
        .map((s, i) => Math.round(s.left - slots[i]!.right));
      expect(new Set(gaps).size).toBe(1);
      await shot(page, `sign-in-code-${theme}-${width}`);
    });
  }
}

test("keyboard hints disappear on a coarse pointer and stay on a fine one", async ({
  browser,
}) => {
  const fine = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(fine);
  await expect(fine.locator("kbd").first()).toBeVisible();
  await fine.close();

  const touch = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await touch.newPage();
  await signIn(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
  ).toBe(true);
  await expect(page.locator("kbd:visible")).toHaveCount(0);
  await touch.close();
});

test("a coarse pointer gets 44px buttons with 16px icons", async ({
  browser,
}) => {
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await touch.newPage();
  await signIn(page);
  const capture = page.getByRole("button", { name: "Capture" }).first();
  const box = await capture.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  const icon = await capture
    .locator("svg")
    .first()
    .evaluate((svg) => svg.getBoundingClientRect().width);
  expect(icon).toBe(16);
  await touch.close();
});

for (const theme of THEMES) {
  test(`toast: an overlay surface with an ink action, ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await paste(page, "A Memory for the toast");
    const toast = page.locator("[data-sonner-toast][data-front=true]");
    await expect(toast).toContainText("Captured");
    const colours = await toast.evaluate((el) => {
      const root = getComputedStyle(document.documentElement);
      const action = el.querySelector("[data-button]")!;
      return {
        background: getComputedStyle(el).backgroundColor,
        surface: root.getPropertyValue("--surface").trim(),
        ink: root.getPropertyValue("--ink").trim(),
        actionBackground: getComputedStyle(action).backgroundColor,
      };
    });
    const rgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(colours.background).toBe(rgb(colours.surface));
    expect(colours.actionBackground).toBe(rgb(colours.ink));
    if (OUT) await page.waitForTimeout(600);
    await shot(page, `toast-${theme}`);
  });
}

test("the search row keeps its clear control inside one surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.locator("[data-desk=search]:visible").click();
  await page.getByRole("combobox").fill("memory");
  await page.keyboard.press("Enter");
  const clear = page.getByRole("button", { name: "Clear Search" }).first();
  await expect(clear).toBeVisible();
  const row = page.locator(".group\\/search:visible").first();
  const box = (await row.boundingBox())!;
  // Every control is a sibling inside the one surface, 8px apart.
  const parts = await row.evaluate((el) =>
    [...el.children]
      .filter((child) => child.getClientRects().length > 0)
      .map((child) => {
        const r = child.getBoundingClientRect();
        return { left: r.left, right: r.right };
      })
  );
  expect(parts.length).toBeGreaterThanOrEqual(2);
  parts.slice(1).forEach((part, i) => {
    expect(Math.round(part.left - parts[i]!.right)).toBe(8);
  });
  expect(parts[0]!.left).toBeGreaterThanOrEqual(box.x);
  expect(parts.at(-1)!.right).toBeLessThanOrEqual(box.x + box.width);
  await expect(clear).toBeVisible();
  await shot(page, "search-row");
});

test("the phone wordmark is a Navigation menu that reaches Settings and returns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "admin@example.test");
  const trigger = page.getByRole("button", { name: "Navigation", exact: true });
  // The page that mounts it is stream B's (B3); until then there is nothing to test.
  test.skip(
    (await trigger.count()) === 0,
    "Library does not mount PhoneNavigation yet (B3)"
  );
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Navigation" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    /Library/,
    /Settings/,
    /Admin/,
  ]);
  await shot(page, "phone-menu");
  await menu.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(menu).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

// ---- Primitives on their own (src/r1-a-fixtures.tsx, dev-only) -------------

const FIXTURES = "/r1-a-fixtures.html";

/** The running animation of an element's computed style, right now. */
const motion = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel)!);
    return {
      name: style.animationName,
      seconds: parseFloat(style.animationDuration),
      scale: style.scale,
    };
  }, selector);

const openByPointer = async (page: Page, name: string) => {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

const openByKeyboard = async (page: Page, name: string) => {
  await page.getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("dialog entrances", () => {
  test("plain dialog: only a 150ms fade, so the viewers behave as before", async ({
    page,
  }) => {
    await page.goto(FIXTURES);
    await openByPointer(page, "Plain Dialog");
    const m = await motion(page, "[data-slot=dialog-content]");
    expect(m.name).toBe("spark-fade-in");
    expect(m.seconds).toBeCloseTo(0.15, 3);
    expect(m.scale).toBe("none");
  });

  test("presentation=dialog: pointer grows in 180ms, keyboard only fades in 150ms", async ({
    page,
  }) => {
    await page.goto(FIXTURES);
    await openByPointer(page, "Pointer Dialog");
    const pointer = await motion(page, "[data-slot=dialog-content]");
    expect(pointer.name).toBe("spark-dialog-in");
    expect(pointer.seconds).toBeCloseTo(0.18, 3);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await openByKeyboard(page, "Pointer Dialog");
    const keyboard = await motion(page, "[data-slot=dialog-content]");
    expect(keyboard.name).toBe("spark-fade-in");
    expect(keyboard.seconds).toBeCloseTo(0.15, 3);
  });

  test("full screen only fades", async ({ page }) => {
    await page.goto(FIXTURES);
    await openByPointer(page, "Full Screen");
    const m = await motion(page, "[data-slot=dialog-content]");
    expect(m.name).toBe("spark-fade-in");
    expect(m.seconds).toBeCloseTo(0.15, 3);
  });

  test("reduced motion: every overlay is opacity only and at most 150ms", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(FIXTURES);
    for (const name of [
      "Pointer Dialog",
      "Sheet",
      "Plain Dialog",
      "Full Screen",
    ]) {
      await openByPointer(page, name);
      const m = await motion(page, "[data-slot=dialog-content]");
      expect(m.name, name).toBe("spark-fade-in");
      expect(m.seconds, name).toBeLessThanOrEqual(0.15);
      expect(m.scale, name).toBe("none");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    // The menu too, opened by pointer: 180ms scale becomes a 150ms fade.
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    const menu = await motion(page, "[data-slot=menu-content]");
    expect(menu.name).toBe("spark-fade-in");
    expect(menu.seconds).toBeLessThanOrEqual(0.15);
    expect(menu.scale).toBe("none");
  });

  test("a sheet rises 8% in 260ms on a phone; the same dialog is centred on a desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(FIXTURES);
    await openByPointer(page, "Sheet");
    const rise = await motion(page, "[data-slot=dialog-content]");
    expect(rise.name).toBe("spark-sheet-in");
    expect(rise.seconds).toBeCloseTo(0.26, 3);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 700 });
    await openByPointer(page, "Sheet");
    const desk = (await page.getByRole("dialog").boundingBox())!;
    expect(Math.abs(desk.x + desk.width / 2 - 512)).toBeLessThan(2);
    expect(desk.y).toBeGreaterThan(0);
    expect(desk.y + desk.height).toBeLessThan(700);
  });
});

test.describe("phone sheet", () => {
  test("is bottom aligned and capped, with one scrolling body and a footer that stays visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto(FIXTURES);
    await openByKeyboard(page, "Sheet");
    await page.waitForTimeout(350);
    const dialog = (await page.getByRole("dialog").boundingBox())!;
    expect(Math.round(dialog.x)).toBe(0);
    expect(Math.round(dialog.width)).toBe(390);
    expect(Math.round(dialog.y + dialog.height)).toBe(600);
    expect(dialog.height).toBeLessThanOrEqual(600 * 0.92 + 1);
    const body = page.getByTestId("body");
    const scrolls = await body.evaluate(
      (el) => el.scrollHeight > el.clientHeight
    );
    expect(scrolls).toBe(true);
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const footer = (await page
      .getByRole("button", { name: "Done" })
      .boundingBox())!;
    const header = (await page
      .getByRole("heading", { name: "Sheet" })
      .boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(600);
    expect(header.y).toBeGreaterThanOrEqual(dialog.y);
    // Only the body scrolled: the page behind did not move.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await overflows(page)).toBe(false);
  });

  test("traps Tab, and gives focus back to its trigger on Escape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto(FIXTURES);
    await openByKeyboard(page, "Sheet");
    const inside = () =>
      page.evaluate(
        () => !!document.activeElement?.closest("[data-slot=dialog-content]")
      );
    expect(await inside()).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Sheet", exact: true })
    ).toBeFocused();
  });
});

test.describe("checkbox", () => {
  const duration = (page: Page) =>
    page.evaluate(() => {
      const box = document.querySelector("[data-slot=checkbox]")!;
      const mark = document.querySelector("[data-slot=checkbox-mark]")!;
      return {
        box: getComputedStyle(box).transitionDuration,
        mark: getComputedStyle(mark).transitionDuration,
      };
    });

  test("draws in 120ms for a pointer", async ({ page }) => {
    await page.goto(FIXTURES);
    await page.getByRole("checkbox").click();
    await expect(page.getByRole("checkbox")).toBeChecked();
    expect(await duration(page)).toEqual({ box: "0.12s", mark: "0.12s" });
  });

  test("is immediate from the keyboard", async ({ page }) => {
    await page.goto(FIXTURES);
    await page.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox")).toBeChecked();
    expect(await duration(page)).toEqual({ box: "0s", mark: "0s" });
  });

  test("is immediate under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(FIXTURES);
    await page.getByRole("checkbox").click();
    expect(await duration(page)).toEqual({ box: "0s", mark: "0s" });
  });
});

test.describe("PhoneNavigation", () => {
  test("opens from the keyboard, moves with the arrows, navigates, and returns focus on Escape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(FIXTURES);
    const trigger = page.getByRole("button", {
      name: "Navigation",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Navigation" });
    await expect(menu).toBeVisible();
    // Keyboard-opened: immediate, no entrance.
    expect((await motion(page, "[data-slot=menu-content]")).name).toBe("none");
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveText([/Library/, /Settings/, /Admin/]);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Settings Page" })
    ).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The destination marks itself current; Library is one choice back.
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    const here = page.getByRole("menuitem", { name: "Settings" });
    await expect(here).toHaveAttribute("aria-current", "page");
    await page.getByRole("menuitem", { name: "Library" }).click();
    await expect(page.getByRole("button", { name: "Outside" })).toBeVisible();
  });

  test("pointer open grows from its trigger in 180ms", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(FIXTURES);
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    const m = await motion(page, "[data-slot=menu-content]");
    expect(m.name).toBe("spark-menu-in");
    expect(m.seconds).toBeCloseTo(0.18, 3);
  });
});
