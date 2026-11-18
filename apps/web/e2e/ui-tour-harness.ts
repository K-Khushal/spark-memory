import {
  expect,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Locator,
} from "@playwright/test";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Memory } from "../src/library/use-library";
import { signIn } from "./sign-in";
import { pageSvg, SHAPES, sceneSvg } from "./ui-tour-fixtures";

// The harness behind ui-tour.screenshots.ts: where files go, how a step is
// shot in every theme and width, the index.md it leaves behind, and the
// network doubles that give the Library a fixed set of Memories.

export const OUT = resolve(process.env.UI_TOUR_OUT ?? "test-results/ui-tour");
export const VIDEOS = resolve(OUT, "videos");

export const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
/** An extension popup: 320px wide, shot only as tall as its content. */
export const POPUP = [{ width: 320, height: 600 }] as const;
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

type Entry = {
  n: number;
  slug: string;
  line: string;
  section: string;
  files: { name: string; theme: Theme; width: number }[];
  error?: string;
};
const entries: Entry[] = [];
const motionEntries: string[] = [];
let motionSummary: string[] = [];
export const recordMotionSummary = (rows: string[]) => {
  motionSummary = rows;
};
export const recordMotion = (rows: string[]) =>
  motionEntries.push(...rows.map((row) => row.replace(/\s*\n\s*/g, " ")));
const videoEntries: { name: string; line: string }[] = [];
let counter = 0;
let section = "";
let browserVersion = "not recorded";

/** Clears what an earlier tour left (only its own files), so the folder is this run's alone. */
export function prepareOut() {
  mkdirSync(VIDEOS, { recursive: true });
  for (const file of readdirSync(OUT))
    if (
      /^\d\d-.*\.png$/.test(file) ||
      file === "index.md" ||
      file.startsWith(".probe-")
    )
      rmSync(resolve(OUT, file));
  for (const file of readdirSync(VIDEOS))
    if (file.endsWith(".webm") || file.startsWith(".raw"))
      rmSync(resolve(VIDEOS, file), { recursive: true, force: true });
}

export const setSection = (name: string) => {
  section = name;
};
export const failures = () => entries.filter((e) => e.error);
export const recordVideo = (name: string, line: string) =>
  videoEntries.push({ name, line });

function findFfmpeg(): string | undefined {
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
  } catch {
    const playwrightCache = resolve(
      process.env.HOME ?? "/data/home",
      ".cache/ms-playwright"
    );
    if (existsSync(playwrightCache)) {
      for (const dir of readdirSync(playwrightCache)) {
        if (dir.startsWith("ffmpeg")) {
          const bin = resolve(playwrightCache, dir, "ffmpeg-linux");
          if (existsSync(bin)) return bin;
        }
      }
    }
    return undefined;
  }
}

/**
 * Trims initial white Playwright launch frames from a recording so it begins
 * at the first paint of the app (skeleton or content).
 */
export function trimVideoToFirstPaint(
  rawPath: string,
  outputPath: string,
  width: number
) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    writeFileSync(outputPath, readFileSync(rawPath));
    return;
  }

  // A 1440x900 pure white PNG compresses to ~6KB; 390x844 compresses to ~2.8KB.
  // First paint (skeleton or content) produces >10KB.
  const threshold = width > 1000 ? 7000 : 3500;
  const tmpFrame = resolve(
    OUT,
    `.probe-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );

  function isBlank(t: number): boolean {
    try {
      execFileSync(
        ffmpeg!,
        ["-ss", t.toFixed(2), "-i", rawPath, "-vframes", "1", tmpFrame, "-y"],
        { stdio: "ignore" }
      );
      const size = existsSync(tmpFrame) ? statSync(tmpFrame).size : 0;
      return size <= threshold;
    } catch {
      return false;
    } finally {
      if (existsSync(tmpFrame)) rmSync(tmpFrame, { force: true });
    }
  }

  // Binary search for the transition from launch white to app first paint
  let low = 0.0;
  let high = 3.0;

  if (isBlank(high)) {
    writeFileSync(outputPath, readFileSync(rawPath));
    return;
  }

  for (let i = 0; i < 7; i++) {
    const mid = (low + high) / 2;
    if (isBlank(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const firstPaintTime = Number(high.toFixed(2));
  if (firstPaintTime <= 0.05) {
    writeFileSync(outputPath, readFileSync(rawPath));
    return;
  }

  try {
    execFileSync(
      ffmpeg,
      [
        "-ss",
        String(firstPaintTime),
        "-i",
        rawPath,
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "1M",
        "-crf",
        "30",
        outputPath,
        "-y",
      ],
      { stdio: "ignore" }
    );
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      writeFileSync(outputPath, readFileSync(rawPath));
    }
  } catch {
    writeFileSync(outputPath, readFileSync(rawPath));
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Waits for fonts, layout and every finite animation, so a shot is the settled state. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    );
    // A stuck animation must not stall the tour: wait for the rest, then go on.
    await Promise.race([
      Promise.allSettled(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished)
      ),
      new Promise((done) => setTimeout(done, 600)),
    ]);
  });
}

const touchSessions = new WeakMap<Page, CDPSession>();

/**
 * A phone shot is taken as a touch device: `pointer: coarse` rules apply (44px
 * targets, no keyboard hints), as on the phone. Desktop shots turn it off.
 */
export async function setTouch(page: Page, on: boolean) {
  let session = touchSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    touchSessions.set(page, session);
  }
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: on,
    maxTouchPoints: 1,
  });
}

export async function resetView(page: Page) {
  await setTouch(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
}

/**
 * One screen and state, shot in light and dark at 1440x900 and 390x844.
 * `run` reaches the state; the shots follow. A step that throws is logged and
 * the tour goes on, so one broken screen never hides the rest (the test fails
 * at the end naming it).
 */
export async function step(
  page: Page,
  slug: string,
  line: string,
  run: () => Promise<void>,
  options: {
    fullPage?: boolean;
    /** Also a second shot at the bottom of the page (Settings, Admin), named `NN-slug-scrolled-…`. */
    scrolled?: boolean;
    /** The sizes to shoot; both widths unless it says otherwise. */
    sizes?: readonly { width: number; height: number }[];
    /** Shoot only as tall as the page's content (an extension popup is as tall as it is). */
    fitContent?: boolean;
    recover?: () => Promise<void>;
    beforeShot?: (width: number, theme: Theme) => Promise<void>;
  } = {}
) {
  const entry: Entry = { n: ++counter, slug, line, section, files: [] };
  entries.push(entry);
  mkdirSync(OUT, { recursive: true });
  try {
    browserVersion = page.context().browser()?.version() ?? "unknown";
    await resetView(page);
    await run();
    for (const size of options.sizes ?? SIZES) {
      await page.setViewportSize(size);
      // The phone is a touch device; the checks below name what that changes.
      await setTouch(page, size.width < 640 && !options.fitContent);
      if (size.width < 640 && !options.fitContent)
        expect(
          await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
        ).toBe(true);
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await options.beforeShot?.(size.width, theme);
        await settle(page);
        if (slug.startsWith("detail-")) {
          await expect(page.getByRole("dialog")).toBeVisible();
          if (slug.startsWith("detail-pdf")) {
            const name =
              slug === "detail-pdf"
                ? "Garden Report 2026"
                : "Complete Field Guide to Kitchen Gardens, Second Edition";
            const reader = page.getByRole("dialog", { name, exact: true });
            await expect(reader).toBeVisible();
            await expect(
              reader.getByRole("img", { name: "Page 1", exact: true }).first()
            ).toBeVisible();
            if (slug.endsWith("partly-indexed"))
              await expect(
                reader
                  .getByText("Partly Indexed", { exact: true })
                  .filter({ visible: true })
              ).toBeVisible();
          }
        }
        const shoot = async (label: string) => {
          const name = `${pad(entry.n)}-${slug}${label}-${theme}-${size.width}.png`;
          const clip = options.fitContent
            ? {
                x: 0,
                y: 0,
                width: size.width,
                height: Math.min(
                  size.height,
                  await page.evaluate(() => document.body.scrollHeight)
                ),
              }
            : undefined;
          await page.screenshot({
            path: resolve(OUT, name),
            animations: "disabled",
            fullPage: options.fullPage ?? false,
            ...(clip && { clip }),
          });
          entry.files.push({ name, theme, width: size.width });
        };
        await shoot("");
        if (size.width === 390 && slug === "library-wall") {
          const rail = page.locator("[data-more-right]");
          await rail.evaluate((el) => {
            el.scrollLeft = 0;
            el.dispatchEvent(new Event("scroll"));
          });
          await expect(rail).toHaveAttribute("data-more-right", "true");
          expect(
            await rail.evaluate((el) => getComputedStyle(el).maskImage)
          ).toContain("linear-gradient");
          await rail.evaluate((el) => {
            el.scrollLeft = el.scrollWidth;
            el.dispatchEvent(new Event("scroll"));
          });
          await expect(rail).toHaveAttribute("data-more-right", "false");
          expect(
            await rail.evaluate((el) => getComputedStyle(el).maskImage)
          ).toBe("none");
          await rail.evaluate((el) => {
            el.scrollLeft = 0;
          });
        }
        if (
          size.width === 390 &&
          [
            "library-wall",
            "search-empty-menu",
            "detail-note",
            "detail-editing",
            "capture-dialog",
            "settings",
          ].includes(slug)
        ) {
          const safeArea = await page.context().newCDPSession(page);
          await safeArea.send("Emulation.setSafeAreaInsetsOverride", {
            insets: { top: 0, left: 0, right: 0, bottom: 34 },
          });
          for (const width of [390, 320]) {
            for (const zoom of [100, 200]) {
              await page.setViewportSize({ width, height: 844 });
              await page.evaluate((zoom) => {
                document.documentElement.style.fontSize = `${zoom}%`;
              }, zoom);
              await settle(page);
              expect(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth
                )
              ).toBe(true);
              const dialog = page.getByRole("dialog");
              const actions =
                slug === "library-wall"
                  ? [
                      page
                        .getByRole("button", { name: "Capture", exact: true })
                        .filter({ visible: true }),
                    ]
                  : slug === "search-empty-menu"
                    ? [page.getByPlaceholder("Search…")]
                    : slug === "settings"
                      ? [
                          page.getByRole("button", {
                            name: "Export",
                            exact: true,
                          }),
                          page.getByRole("button", {
                            name: "Delete Account",
                            exact: true,
                          }),
                        ]
                      : [
                          dialog.getByRole("button", {
                            name:
                              slug === "capture-dialog"
                                ? /^Capture/
                                : slug === "detail-editing"
                                  ? "Done"
                                  : "Edit",
                            exact: slug !== "capture-dialog",
                          }),
                        ];
              if (slug === "detail-note")
                actions.push(
                  dialog.getByRole("button", { name: "Close", exact: true })
                );
              const inVisualViewport = async (control: Locator) => {
                await control.scrollIntoViewIfNeeded();
                await expect(control).toBeVisible();
                expect(
                  await control.evaluate((el) => {
                    const r = el.getBoundingClientRect(),
                      v = window.visualViewport!;
                    let left = Math.max(r.left, v.offsetLeft),
                      right = Math.min(r.right, v.offsetLeft + v.width);
                    let top = Math.max(r.top, v.offsetTop),
                      bottom = Math.min(r.bottom, v.offsetTop + v.height);
                    for (
                      let parent = el.parentElement;
                      parent;
                      parent = parent.parentElement
                    ) {
                      const style = getComputedStyle(parent);
                      if (
                        /(auto|scroll|hidden|clip)/.test(
                          style.overflow + style.overflowY + style.overflowX
                        )
                      ) {
                        const box = parent.getBoundingClientRect();
                        left = Math.max(left, box.left + parent.clientLeft);
                        right = Math.min(
                          right,
                          box.left + parent.clientLeft + parent.clientWidth
                        );
                        top = Math.max(top, box.top + parent.clientTop);
                        bottom = Math.min(
                          bottom,
                          box.top + parent.clientTop + parent.clientHeight
                        );
                      }
                    }
                    const hit = (x: number, y: number) => {
                      const target = document.elementFromPoint(x, y);
                      return (
                        target === el ||
                        (target !== null && el.contains(target))
                      );
                    };
                    const centre = hit(
                      (r.left + r.right) / 2,
                      (r.top + r.bottom) / 2
                    );
                    const field =
                      el instanceof HTMLTextAreaElement ||
                      el instanceof HTMLInputElement;
                    const style = getComputedStyle(el);
                    const firstX = r.left + parseFloat(style.paddingLeft) + 2;
                    const firstY =
                      r.top +
                      parseFloat(style.paddingTop) +
                      parseFloat(style.fontSize) / 2;
                    return (
                      right > left &&
                      bottom > top &&
                      centre &&
                      (!field ||
                        (firstX >= left &&
                          firstX < right &&
                          firstY >= top &&
                          firstY < bottom &&
                          hit(firstX, firstY) &&
                          el.scrollTop === 0 &&
                          el.scrollLeft === 0))
                    );
                  }),
                  `${slug} ${width}px ${zoom}%: ${(await control.getAttribute("aria-label")) ?? (await control.textContent())} must clear scrolling clips and overlays`
                ).toBe(true);
              };
              if (["detail-note", "detail-editing"].includes(slug)) {
                expect(
                  await dialog
                    .getByRole("textbox", { name: "Title", exact: true })
                    .evaluate(
                      (el) =>
                        el.clientWidth /
                        parseFloat(getComputedStyle(el).fontSize)
                    )
                ).toBeGreaterThanOrEqual(6);
              }
              for (const action of actions) await inVisualViewport(action);
              const name = `${pad(entry.n)}-${slug}-text-${zoom}-${theme}-${width}.png`;
              await page.screenshot({
                path: resolve(OUT, name),
                animations: "disabled",
              });
              entry.files.push({ name, theme, width });
              {
                const field = ["detail-editing", "capture-dialog"].includes(
                  slug
                )
                  ? dialog.getByRole("textbox", { name: "Text", exact: true })
                  : slug === "search-empty-menu"
                    ? page.getByPlaceholder("Search…")
                    : undefined;
                const original = field ? await field.inputValue() : undefined;
                if (
                  field &&
                  ["detail-editing", "capture-dialog"].includes(slug)
                ) {
                  await field.fill("Tour caret fixture");
                  await field.press("Home");
                  await inVisualViewport(field);
                }
                await (field ?? actions[0]!).focus();
                await page.setViewportSize({ width, height: 500 });
                expect(
                  await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                  )
                ).toBe(true);
                await field?.scrollIntoViewIfNeeded();
                for (const action of actions) await inVisualViewport(action);
                if (field) await inVisualViewport(field);
                for (const action of actions) await inVisualViewport(action);
                if (field)
                  expect(
                    await field.evaluate((el) => {
                      const r = el.getBoundingClientRect(),
                        v = visualViewport!;
                      return (
                        r.top >= v.offsetTop &&
                        r.bottom <= v.offsetTop + v.height + 1
                      );
                    })
                  ).toBe(true);
                const keyboardName = `${pad(entry.n)}-${slug}-short-viewport-text-${zoom}-${theme}-${width}.png`;
                await page.screenshot({
                  path: resolve(OUT, keyboardName),
                  animations: "disabled",
                });
                entry.files.push({ name: keyboardName, theme, width });
                await page.setViewportSize({ width, height: 844 });
                if (
                  field &&
                  ["detail-editing", "capture-dialog"].includes(slug)
                ) {
                  await page.evaluate(() => {
                    Object.defineProperty(visualViewport!, "height", {
                      configurable: true,
                      value: 500,
                    });
                    visualViewport!.dispatchEvent(new Event("resize"));
                  });
                  await settle(page);
                  expect(await page.evaluate(() => innerHeight)).toBe(844);
                  expect(
                    await dialog.evaluate((el) =>
                      parseFloat(
                        (el as HTMLElement).style.getPropertyValue(
                          "--keyboard-inset"
                        )
                      )
                    )
                  ).toBeGreaterThan(0);
                  await inVisualViewport(field);
                  for (const action of actions) await inVisualViewport(action);
                  await inVisualViewport(field);
                  const visualName = `${pad(entry.n)}-${slug}-visual-keyboard-text-${zoom}-${theme}-${width}.png`;
                  await page.screenshot({
                    path: resolve(OUT, visualName),
                    animations: "disabled",
                  });
                  entry.files.push({ name: visualName, theme, width });
                  await page.evaluate(() => {
                    Reflect.deleteProperty(visualViewport!, "height");
                    visualViewport!.dispatchEvent(new Event("resize"));
                  });
                }
                if (
                  field &&
                  ["detail-editing", "capture-dialog"].includes(slug)
                )
                  await field.fill(original!);
              }
            }
          }
          await page.evaluate(() =>
            document.documentElement.style.removeProperty("font-size")
          );
          await safeArea.send("Emulation.setSafeAreaInsetsOverride", {
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          });
          if (slug === "detail-editing" && theme === "dark") {
            await page
              .getByRole("dialog")
              .getByRole("button", { name: "Done", exact: true })
              .click();
            await run();
          }
          await safeArea.detach();
          await page.setViewportSize(size);
        }
        if (options.scrolled) {
          await page.evaluate(() =>
            scrollTo(0, document.documentElement.scrollHeight)
          );
          await settle(page);
          await shoot("-scrolled");
          await page.evaluate(() => scrollTo(0, 0));
        }
      }
    }
  } catch (error) {
    entry.error = String(error instanceof Error ? error.message : error).split(
      "\n"
    )[0];
    console.log(`ui-tour: ${pad(entry.n)} ${slug} failed: ${String(error)}`);
  } finally {
    await page
      .evaluate(() => {
        document.documentElement.style.removeProperty("font-size");
        Reflect.deleteProperty(visualViewport!, "height");
        visualViewport!.dispatchEvent(new Event("resize"));
      })
      .catch(() => {});
    await resetView(page).catch(() => {});
    await (options.recover ?? (() => page.keyboard.press("Escape")))().catch(
      () => {}
    );
  }
}

/** Writes index.md from what the steps shot, and checks every file is there and not blank. */
export function writeIndex() {
  const sections = [...new Set(entries.map((e) => e.section))];
  const lines = [
    "# Spark UI tour",
    "",
    `Commit: ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`,
    `dirty: ${execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() ? "yes" : "no"}`,
    `Fixture SHA256: ${createHash("sha256")
      .update(readFileSync(resolve("e2e/ui-tour-fixtures.ts")))
      .digest("hex")}`,
    `Bundle: ${process.env.UI_TOUR_BUNDLE ?? "Vite development modules at the commit above (working tree changes included)"}`,
    `Browser: Chromium ${browserVersion} (Playwright); reduced motion: no-preference except explicitly named reduced-motion recordings. Viewports: 1440×900 desktop/no touch, 390×844 phone/touch, 320px extension/no touch.`,
    "",
    "Short-viewport captures resize layout and visual height to 500px. Visual-keyboard captures keep layout height at 844px and override visualViewport.height to 500px, asserting a non-zero keyboard inset. This is simulated coverage, not physical-device acceptance. Every screen and state in light and dark at 1440x900 and 390x844 (a touch device, so `pointer: coarse` rules apply). Files are `NN-screen-state-theme-width.png`; the same NN is the same screen and state in all four. Settings and Admin are shot at the viewport and again scrolled to the bottom (`-scrolled`); an extension popup is shot at 320px wide, as tall as its content.",
    "",
  ];
  for (const name of sections) {
    lines.push(`## ${name}`, "");
    for (const e of entries.filter((x) => x.section === name)) {
      if (e.error) {
        lines.push(`- ${pad(e.n)}-${e.slug}: NOT CAPTURED (${e.error})`);
        continue;
      }
      for (const f of e.files)
        lines.push(
          `- \`${f.name}\`: ${e.line} (${f.theme}, ${f.width === 1440 ? "desktop 1440x900" : f.width === 320 ? "popup 320px" : "phone 390x844"})`
        );
    }
    lines.push("");
  }
  if (motionEntries.length) {
    lines.push(
      "## Motion Ledger",
      "",
      `Assertions: ${motionSummary.filter((s) => s.startsWith("PASS")).length} passed; ${motionSummary.filter((s) => s.startsWith("FAIL")).length} failed.`,
      ...motionSummary.map((s) => "- " + s),
      "",
      "| Interaction | Element | Property | Duration (ms) | Easing | Delay (ms) | CSS Duration | CSS Easing |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...motionEntries,
      ""
    );
  }
  if (videoEntries.length) {
    lines.push("## Videos", "");
    for (const v of videoEntries)
      lines.push(`- \`videos/${v.name}\`: ${v.line}`);
    lines.push("");
  }
  writeFileSync(resolve(OUT, "index.md"), lines.join("\n"));
  const missing = entries
    .flatMap((e) => e.files)
    .filter((f) => !existsSync(resolve(OUT, f.name)))
    .map((f) => f.name);
  const missingVideos = videoEntries
    .filter((v) => !existsSync(resolve(VIDEOS, v.name)))
    .map((v) => v.name);
  return { missing: [...missing, ...missingVideos] };
}

// ---------------------------------------------------------------------------
// The Library double.

export type Mock = {
  memories: Memory[];
  /** Delay before the Library answers, ms (the loading state). */
  delay: number;
  /** Hold list responses until every loading capture is written. */
  listGate?: Promise<void>;
  /** The Library, or search, is unreachable. */
  listFails: boolean;
  searchFails: boolean;
  searchDelay?: number;
  /** Direct and related ids for a query (lower case), set by the tour. */
  answers: Record<string, { direct: string[]; related?: string[] }>;
  /** What Get Started reports; unset leaves it to the real server. */
  onboarding?: Record<string, unknown>;
};

const KIND_OF: Record<string, string[]> = {
  image: ["image"],
  pdf: ["pdf"],
  video: ["video"],
  link: ["link", "social_post"],
  note: ["text"],
};

/**
 * Serves `mock.memories` as the whole Library and answers search from it:
 * chips filter for real, words match through `mock.answers`. Edits and
 * deletes succeed and change nothing, so a step never needs the real API.
 */
export async function installLibrary(context: BrowserContext, mock: Mock) {
  await context.route("**/tour/video-poster.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: sceneSvg(0, 1600, 900),
    })
  );
  await context.route(/\/tour\/image-(\d+)\.svg$/, (route) => {
    const index = Number(/image-(\d+)/.exec(route.request().url())![1]);
    const shape = SHAPES[index % SHAPES.length]!;
    return route.fulfill({
      contentType: "image/svg+xml",
      body: sceneSvg(index, shape.w, shape.h),
    });
  });
  await context.route(/\/tour\/page-(\d+)\.svg$/, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: pageSvg(Number(/page-(\d+)/.exec(route.request().url())![1])),
    })
  );
  await context.route(
    (url) => url.pathname === "/api/onboarding",
    (route) =>
      mock.onboarding && route.request().method() === "GET"
        ? route.fulfill({ json: mock.onboarding })
        : route.fallback()
  );
  await context.route(
    (url) =>
      url.pathname.startsWith("/api/memories") ||
      url.pathname === "/api/search",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const byId = (id: string) => mock.memories.find((m) => m.id === id);

      if (path === "/api/memories" && method === "GET") {
        await mock.listGate;
        if (mock.delay) await new Promise((r) => setTimeout(r, mock.delay));
        if (mock.listFails) return route.fulfill({ status: 503, json: {} });
        const ids = url.searchParams.get("ids");
        return route.fulfill({
          json: {
            memories: ids
              ? ids.split(",").flatMap((id) => byId(id) ?? [])
              : mock.memories,
            unfinished: [],
          },
        });
      }
      if (path === "/api/search" && method === "POST") {
        if (mock.searchDelay)
          await new Promise((r) => setTimeout(r, mock.searchDelay));
        if (mock.searchFails) return route.fulfill({ status: 503, json: {} });
        const body = request.postDataJSON() as {
          q: string;
          mode?: "instant" | "full";
          chips?: Record<string, string>;
        };
        let pool = mock.memories;
        const chips = body.chips ?? {};
        if (chips.kind)
          pool = pool.filter((m) =>
            (KIND_OF[chips.kind!] ?? []).includes(
              m.kind === "link" &&
                /x\.com|tiktok|instagram/.test(m.sourceUrl ?? "")
                ? "social_post"
                : m.kind === "text"
                  ? "text"
                  : m.kind
            )
          );
        if (chips.category)
          pool = pool.filter((m) => m.categories.includes(chips.category!));
        if (chips.source)
          pool = pool.filter((m) =>
            (m.sourceUrl ?? "").includes(chips.source!)
          );
        if (chips.colour || chips.when) pool = pool.slice(0, 9);
        const q = body.q.trim().toLowerCase();
        if (!q)
          return route.fulfill({
            json: {
              results: pool.map((m) => ({
                id: m.id,
                match: "direct",
                part: chips.kind
                  ? { kind: "filter", field: "kind", value: chips.kind }
                  : chips.category
                    ? {
                        kind: "filter",
                        field: "category",
                        value: chips.category,
                      }
                    : null,
              })),
            },
          });
        const answer = Object.entries(mock.answers).find(([key]) =>
          q.startsWith(key)
        )?.[1];
        if (!answer) return route.fulfill({ json: { results: [] } });
        const inPool = (id: string) => pool.some((m) => m.id === id);
        const direct = answer.direct.filter(inPool);
        const related =
          body.mode === "full" ? (answer.related ?? []).filter(inPool) : [];
        const part = (id: string) => {
          const m = byId(id)!;
          if (m.kind === "image") return { kind: "field", field: "title" };
          if (m.kind === "pdf")
            return { kind: "field", field: "title", page: 3 };
          return m.title?.toLowerCase().includes(q.split(" ")[0]!)
            ? { kind: "field", field: "title" }
            : {
                kind: "passage",
                field: "body",
                start: 0,
                end: Math.min(40, m.body?.length ?? 0),
              };
        };
        return route.fulfill({
          json: {
            mode: body.mode ?? "instant",
            results: [
              ...direct.map((id) => ({ id, match: "direct", part: part(id) })),
              ...related.map((id) => ({
                id,
                match: "related",
                part: { kind: "overview" },
              })),
            ],
          },
        });
      }
      const similar = /^\/api\/memories\/([0-9a-f-]{36})\/similar$/.exec(path);
      if (similar && method === "GET")
        return route.fulfill({
          json: {
            results: mock.memories
              .filter((m) => m.id !== similar[1] && m.hasVectors)
              .slice(3, 12)
              .map((m) => ({
                id: m.id,
                match: "direct",
                part: { kind: "visual" },
              })),
          },
        });
      const pages = /^\/api\/memories\/([^/]+)\/pages$/.exec(path);
      if (pages && method === "GET")
        return route.fulfill({
          json: {
            pages: Array.from({ length: 30 }, (_, i) => ({
              page: i + 1,
              url: `/tour/page-${i + 1}.svg`,
              width: 612,
              height: 792,
            })),
          },
        });
      const one = /^\/api\/memories\/([0-9a-f-]{36})$/.exec(path);
      if (one && byId(one[1]!)) {
        const memory = byId(one[1]!)!;
        if (method === "GET") return route.fulfill({ json: memory });
        if (method === "PATCH")
          return route.fulfill({
            json: {
              ...memory,
              ...request.postDataJSON(),
              revision: memory.revision + 1,
            },
          });
        if (method === "DELETE") return route.fulfill({ status: 204 });
      }
      if (path === "/api/memories/bulk" && method === "POST")
        return route.fulfill({ json: { results: [] } });
      return route.fallback();
    }
  );
}

/** Onboarding finished, so Get Started is gone from the wall. */
export const FINISHED = {
  step: "done",
  paused: true,
  samplesSeeded: false,
  firstSuccessfulSearchAt: "2026-11-10T09:00:00.000Z",
};

/**
 * Signs in as a new person, so onboarding, Settings and usage start empty.
 * (A deleted address stays refused, so each run takes a new one; the label
 * leads, because the sidebar cuts the address short.)
 */
export async function signInFresh(page: Page, label: string) {
  return signIn(page, `tour.${label}.demo.account.${Date.now()}@example.com`);
}

/** The first tile whose accessible name starts with `name`. */
export const tile = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "All Memories" })
    .getByRole("listitem", { name: new RegExp("^" + escapeRegExp(name)) })
    .first();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
}

/** A ring that follows the pointer and shrinks while a button is down, for the videos. */
export async function withCursor(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const ring = document.createElement("div");
      ring.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #FF3B30;background:rgba(255,59,48,.18);transition:transform 80ms ease-out;left:-50px;top:-50px";
      document.body.append(ring);
      const place = (event: MouseEvent) => {
        ring.style.left = event.clientX + "px";
        ring.style.top = event.clientY + "px";
      };
      document.addEventListener("mousemove", place, true);
      document.addEventListener(
        "mousedown",
        (e) => {
          place(e);
          ring.style.transform = "scale(0.7)";
        },
        true
      );
      document.addEventListener(
        "mouseup",
        () => (ring.style.transform = "scale(1)"),
        true
      );
    });
  });
}
