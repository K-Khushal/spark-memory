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

test("a dialog opened by pointer grows from .98; from the keyboard it only fades", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Capture" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.input)
  ).toBe("pointer");
  // The animation may already be over on a quick machine: its CSS is what counts.
  const entering = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("[data-slot=dialog-content]")!)
        .animationName
  );
  expect(entering).toBe("spark-dialog-in");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // Focus the Capture button and press it: the keyboard opened the dialog.
  await page.getByRole("button", { name: "Capture" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.input)
  ).toBe("keyboard");
  const fading = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("[data-slot=dialog-content]")!)
        .animationName
  );
  expect(fading).toBe("spark-fade-in");
});

test("reduced motion: a dialog never scales", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Capture" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const scale = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("[data-slot=dialog-content]")!)
        .scale
  );
  expect(scale).toBe("none");
});

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
