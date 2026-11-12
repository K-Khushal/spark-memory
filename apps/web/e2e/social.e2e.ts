import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { signIn } from "./sign-in";

// Social posts (#20): the real unpacked extension on saved-DOM stand-ins for
// X and an Instagram reel, the real Worker and Postgres. The test build has
// every host granted (Playwright cannot click the toolbar), so the first-use
// permission prompt itself is covered by the extension's unit tests.
// Build first: WXT_E2E=1 WXT_API_ORIGIN=http://localhost:5173 pnpm --filter @spark/extension build

const POST = `<html><head><title>X</title></head><body><main><article data-testid="tweet">
<div data-testid="User-Name"><a href="/anaperez"><span>Ana Pérez</span></a><a href="/anaperez"><span>@anaperez</span></a></div>
<div data-testid="tweetText"><span>Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled.</span></div>
<a href="/anaperez/status/1850000000000000001"><time datetime="2026-11-09T10:15:00.000Z">10:15 AM</time></a>
</article></main></body></html>`;

const REEL = `<html><head><title>Instagram</title></head><body><main><article>
<header><a href="/ana.bakes/"><span>ana.bakes</span></a></header>
<h1>Sourdough in sixty seconds. Save this for Sunday.</h1>
<time datetime="2026-11-09T08:00:00.000Z"></time>
</article></main></body></html>`;

test("saves an X post and an Instagram reel as the person sees them", async () => {
  test.setTimeout(120_000);
  test.skip(
    process.env.EXTENSION_E2E !== "1",
    "Requires the local unpacked test build"
  );
  const profile = await mkdtemp(resolve(tmpdir(), "spark-social-"));
  const extension = resolve("../extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const dashboard = await context.newPage();
    await signIn(dashboard);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);

    const capture = async (url: string, html: string) => {
      const page = await context.newPage();
      await page.route(url, (route) =>
        route.fulfill({ contentType: "text/html", body: html })
      );
      // Instagram's page API refuses (no session here): the reel stays Reference only.
      await page.route("**/api/v1/media/**", (route) =>
        route.fulfill({ status: 401, body: "" })
      );
      await page.goto(url);
      await page.bringToFront();
      const result = await popup.evaluate(
        async () =>
          await (
            globalThis as unknown as {
              chrome: {
                runtime: { sendMessage(m: unknown): Promise<unknown> };
              };
            }
          ).chrome.runtime.sendMessage({ type: "capture" })
      );
      expect(result).toMatchObject({
        state: expect.stringMatching(/saved|duplicate/),
      });
      await page.close();
    };
    await capture("https://x.com/anaperez/status/1850000000000000001", POST);
    await capture("https://www.instagram.com/reel/C1a_b2/", REEL);

    const memories = (
      await (await dashboard.request.get("/api/memories")).json()
    ).memories as {
      kind: string;
      sourceUrl: string;
      pageTitle: string;
      description: string;
      preservation: string;
    }[];
    const x = memories.find((m) => m.sourceUrl.includes("x.com/anaperez"));
    expect(x).toMatchObject({
      kind: "link",
      preservation: "reference_only",
      description: expect.stringContaining("activation rate doubled"),
    });
    const reel = memories.find((m) => m.sourceUrl.includes("/reel/C1a_b2"));
    expect(reel).toMatchObject({
      kind: "video",
      preservation: "reference_only",
      description: expect.stringContaining("Sourdough in sixty seconds"),
    });
    // The caption is findable at once, from the client's own words.
    const found = await dashboard.request.get("/api/search?q=sourdough");
    expect(
      (
        (await found.json()) as { results: { sourceUrl: string }[] }
      ).results.map((m) => m.sourceUrl)
    ).toContain(reel!.sourceUrl);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
