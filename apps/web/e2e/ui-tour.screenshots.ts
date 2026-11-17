import { expect, chromium, devices, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { signIn, stubTurnstile, fromOwnAddress } from "./sign-in";
import {
  installLibrary,
  settle,
  setSection,
  step,
  tile,
  type Mock,
  writeIndex,
  VIDEOS,
  recordVideo,
  withCursor,
  signInFresh,
  FINISHED,
  prepareOut,
  failures,
  POPUP,
  SIZES,
} from "./ui-tour-harness";
import { pick, tourMemories } from "./ui-tour-fixtures";

// The UI tour: every screen and state of the web app in light and dark at
// 1440x900 and 390x844, plus short videos of the micro-interactions, written
// to UI_TOUR_OUT with an index.md. Run it with `pnpm --filter @spark/web ui-tour`.
// Test tooling only: it uses the local stack's fake providers and fixed
// fixtures (ui-tour-fixtures.ts), so every run draws the same screens.

test.use({ channel: "chromium", actionTimeout: 8_000 });
test.describe.configure({ mode: "serial" });
test.beforeAll(() => prepareOut());

const paste = (page: Page, text: string) =>
  page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);

test("signed out: sign-in and the screens before an account", async ({
  page,
}) => {
  test.setTimeout(240_000);
  setSection("Signed Out");
  await stubTurnstile(page);
  await fromOwnAddress(page);
  const home = async () => {
    await page.goto("/sign-in");
    await expect(page.getByPlaceholder("Email")).toBeVisible();
  };

  await step(page, "sign-in-email", "Sign-in, email entry", home);
  await step(
    page,
    "sign-in-social",
    "Sign-in with Google and GitHub offered above the email field",
    async () => {
      await page.route("**/api/sign-in-options", (route) =>
        route.fulfill({ json: { socialProviders: ["google", "github"] } })
      );
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
    }
  );
  await page.unroute("**/api/sign-in-options");
  await step(
    page,
    "sign-in-email-invalid",
    "Sign-in, an invalid email refused with its error line",
    async () => {
      await home();
      await page.getByPlaceholder("Email").fill("not-an-email");
      await page.getByRole("button", { name: "Continue with Email" }).click();
      await expect(page.locator("#sign-in-error")).toBeVisible();
    }
  );
  await step(
    page,
    "sign-in-failed",
    "Sign-in after a failed social sign-in",
    async () => {
      await page.goto("/sign-in?failed=1");
      await expect(page.getByPlaceholder("Email")).toBeVisible();
    }
  );
  const email = `tour-sign-in-${Date.now()}@example.com`;
  await step(
    page,
    "sign-in-code",
    "Sign-in, the code entry (Check Your Email)",
    async () => {
      await home();
      await page.getByPlaceholder("Email").fill(email);
      const sent = page.waitForResponse(
        (response) =>
          response.url().includes("/email-otp/send-verification-otp") &&
          response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Continue with Email" }).click();
      expect((await sent).ok(), "Local sign-in code request must succeed").toBe(
        true
      );
      await expect(
        page.getByRole("heading", { name: "Check Your Email" })
      ).toBeVisible();
    }
  );
  await step(
    page,
    "sign-in-code-wrong",
    "Sign-in, a wrong code refused",
    async () => {
      await page.getByRole("textbox", { name: "Code" }).fill("000000");
      await expect(page.locator("#sign-in-error")).toBeVisible();
    }
  );
  await step(
    page,
    "sign-in-unreachable",
    "Sign-in when Spark cannot be reached (Spark Is Unreachable, Try Again)",
    async () => {
      await page.route("**/api/sign-in-options", (route) => route.abort());
      await page.goto("/sign-in");
      await expect(
        page.getByRole("heading", { name: "Spark Is Unreachable" })
      ).toBeVisible();
    }
  );
  await page.unroute("**/api/sign-in-options");
  await step(page, "page-not-found", "A page that does not exist", async () => {
    await page.goto("/nowhere");
    await expect(
      page.getByRole("heading", { name: "Page Not Found" })
    ).toBeVisible();
  });
  for (const [reason, line] of [
    [
      "too_large",
      "PWA share target: a shared file over the size limit is refused",
    ],
    [
      "unsupported",
      "PWA share target: a shared file of an unsupported type is refused",
    ],
    ["empty", "PWA share target: an empty share is refused"],
  ] as const)
    await step(
      page,
      `share-refused-${reason.replace("_", "-")}`,
      line,
      async () => {
        await page.goto(`/share?refused=${reason}`);
        await expect(
          page.getByRole("link", { name: "Open Library" })
        ).toBeVisible();
      }
    );
});

test("library: the wall, search, Memory detail, selection and Capture", async ({
  page,
  context,
}) => {
  test.setTimeout(1_200_000);
  setSection("Library");
  await signInFresh(page, "library");
  const memories = tourMemories();
  const kinds = pick(memories);
  const id = (title: string) => memories.find((m) => m.title === title)!.id;
  const mock: Mock = {
    memories,
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {
      garden: {
        direct: [kinds.pdf.id, kinds.longNote.id],
        related: [kinds.image.id, kinds.video.id, kinds.link.id],
      },
      sunrise: {
        direct: [],
        related: [
          kinds.image.id,
          id("Bookshop Cat"),
          kinds.video.id,
          kinds.note.id,
        ],
      },
      bookshop: {
        direct: [id("Bookshop Cat")],
        related: [kinds.link.id, id("Reading List")],
      },
    },
  };
  await installLibrary(context, mock);
  const wall = page.getByRole("list", { name: "All Memories" });
  const openWall = async () => {
    await page.goto("/");
    await expect(wall).toBeVisible({ timeout: 30_000 });
    await expect(wall.getByRole("listitem").first()).toBeVisible();
    // A cached wall can paint before the shell registers its shortcuts.
    await settle(page);
  };
  const closeAll = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  };
  const opts = { recover: closeAll };
  /** Steps that build on the one before keep its state: no clean-up between them. */
  const chain = { recover: async () => {} };

  let releaseLoading: () => void = () => {};
  await step(
    page,
    "library-loading",
    "Library skeleton loading tiles until the Library arrives",
    async () => {
      mock.listGate = new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });
      await page.goto("/");
      await expect(
        page.locator('main [data-slot="skeleton"]').first()
      ).toBeVisible();
    },
    {
      beforeShot: async () => {
        await expect(
          page.locator('main [data-slot="skeleton"]').first()
        ).toBeVisible();
      },
      recover: async () => {
        releaseLoading();
        mock.listGate = undefined;
      },
    }
  );
  await expect(wall).toBeVisible({ timeout: 30_000 });
  await step(
    page,
    "library-wall",
    "Library wall, the full mixed Library",
    openWall,
    opts
  );
  await step(
    page,
    "library-navigation",
    "Library navigation: sidebar on desktop, Navigation menu open on phone",
    openWall,
    {
      recover: closeAll,
      beforeShot: async (width) => {
        if (width === 390) {
          const menu = page.getByRole("menu", {
            name: "Navigation",
            exact: true,
          });
          if (!(await menu.isVisible()))
            await page
              .getByRole("button", { name: "Spark Navigation" })
              .click();
          await expect(menu).toBeVisible();
        }
      },
    }
  );
  await step(
    page,
    "library-wall-scrolled",
    "Library wall scrolled down, the virtualised wall mid-Library",
    async () => {
      await openWall();
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(400);
    },
    opts
  );
  await step(
    page,
    "library-unreachable",
    "Library Is Unreachable with Try Again",
    async () => {
      mock.listFails = true;
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Library Is Unreachable" })
      ).toBeVisible();
    },
    opts
  );
  mock.listFails = false;

  // Filters and Categories.
  await step(
    page,
    "filter-kind-images",
    "Filtered to the Image kind: only images on the wall",
    async () => {
      await openWall();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page
        .getByRole("list", { name: "Kind" })
        .getByRole("button", { name: /Image/ })
        .click();
      await expect(
        page.getByRole("list", { name: "Filtered Memories" })
      ).toBeVisible();
    },
    opts
  );
  await step(
    page,
    "filter-category-recipe",
    "Filtered to a Category",
    async () => {
      await openWall();
      const categories = page.getByRole("list", {
        name: "Category",
        exact: true,
      });
      const recipe = categories.getByRole("button", {
        name: "Recipe",
        exact: true,
      });
      if (!(await recipe.isVisible()))
        await categories
          .getByRole("button", { name: "More", exact: true })
          .click();
      await recipe.click();
      await expect(
        page.getByRole("list", { name: "Filtered Memories" })
      ).toBeVisible();
    },
    opts
  );

  // Search.
  await step(
    page,
    "search-empty-menu",
    "⌘K Search menu open with nothing typed",
    async () => {
      await openWall();
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByPlaceholder("Search…")).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "search-instant",
    "⌘K instant results while typing",
    async () => {
      await page.getByPlaceholder("Search…").fill("garden");
      await expect(
        page.getByRole("listbox").getByRole("option").first()
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "search-menu-full",
    "⌘K after a pause: full results with Direct and Related Matches",
    async () => {
      await page.waitForTimeout(900);
      await expect(
        page.getByRole("listbox").getByRole("option").nth(2)
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "search-results-wall",
    "Search results on the wall: Direct Matches with why-chips, Related Matches below",
    async () => {
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("list", { name: "Direct Matches" })
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Related Matches" })
      ).toBeVisible();
    },
    opts
  );
  await step(
    page,
    "search-no-results",
    "Search with no results",
    async () => {
      await openWall();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search…").fill("zzzz nothing here");
      await page.waitForTimeout(900);
      await page.keyboard.press("Enter");
      await expect(page.getByText("No Memories Match").first()).toBeVisible();
    },
    opts
  );
  await step(
    page,
    "search-error",
    "Search Is Unreachable, with Try Again, on the wall",
    async () => {
      await openWall();
      mock.searchFails = true;
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search…").fill("bookshop with a cat");
      await page.waitForTimeout(900);
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Search Is Unreachable").first()
      ).toBeVisible();
    },
    opts
  );
  mock.searchFails = false;

  // Memory detail, one of each kind.
  const open = async (title: string) => {
    await openWall();
    const t = tile(page, title);
    await t.scrollIntoViewIfNeeded();
    await t.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };
  await step(
    page,
    "detail-note",
    "Memory detail for a note (text and Capture Note)",
    () => open("Cardamom Buns"),
    {
      ...opts,
      beforeShot: async () => {
        await expect(page.getByRole("dialog")).toHaveAttribute(
          "data-presentation",
          "sheet"
        );
      },
    }
  );
  await step(
    page,
    "detail-note-long",
    "Memory detail for a long note with a very long title",
    () => open("Designing a Personal Library"),
    opts
  );
  await step(
    page,
    "detail-link",
    "Memory detail for a link: the reader view with its Source",
    () => open("The Case for Keeping Everything"),
    opts
  );
  await step(
    page,
    "detail-link-reference-only",
    "Memory detail for a Reference Only link waiting for a Deep fetch",
    () => open("A Thin Page"),
    opts
  );
  await step(
    page,
    "detail-social",
    "Memory detail for a social post",
    () => open("Ana Pérez on X"),
    opts
  );
  await step(
    page,
    "detail-video",
    "Memory detail for a video with its transcript",
    () => open("How Plants Follow the Sun"),
    opts
  );
  await step(
    page,
    "detail-image",
    "Image viewer for an image",
    () => open("Harbour at Dusk"),
    opts
  );
  await step(
    page,
    "detail-pdf",
    "PDF viewer for a PDF",
    () => open("Garden Report 2026"),
    opts
  );
  await step(
    page,
    "detail-pdf-partly-indexed",
    "PDF viewer for a PDF over 30 pages (Partly Indexed)",
    () => open("Complete Field Guide"),
    opts
  );
  await step(
    page,
    "detail-index-failed",
    "Memory detail for a Memory whose Indexing failed, with Retry",
    () => open("Packing"),
    opts
  );
  await step(
    page,
    "detail-non-latin",
    "Memory detail for a Hindi title",
    () => open("नमस्ते"),
    opts
  );
  await step(
    page,
    "detail-editing",
    "Memory detail while the text is being edited",
    async () => {
      await open("Cardamom Buns");
      const text = page.getByRole("textbox", { name: "Text" });
      await text.click();
      await text.press("End");
      await text.pressSequentially(" Bake at 200 degrees for 18 minutes.");
    },
    opts
  );

  // Bulk selection.
  await step(
    page,
    "bulk-selected",
    "Bulk selection: three Memories selected, the selection bar with Delete and Categories",
    async () => {
      await openWall();
      await tile(page, "Cardamom Buns").click({ modifiers: ["ControlOrMeta"] });
      await tile(page, "Studio Window").click();
      await tile(page, "Harbour at Dusk").click();
      await expect(
        page.getByRole("region", { name: "Selection", exact: true })
      ).toContainText("3 Selected");
    },
    chain
  );
  await step(
    page,
    "toast-above-bulk-bar",
    "Captured toast above the active Selection bar",
    async () => {},
    {
      recover: async () => {},
      beforeShot: async () => {
        await paste(
          page,
          `A note captured during selection ${crypto.randomUUID()}`
        );
        const toast = page
          .locator("[data-sonner-toast]")
          .filter({ hasText: "Captured" })
          .last();
        const bar = page.getByRole("region", {
          name: "Selection",
          exact: true,
        });
        await expect(toast).toBeVisible();
        await expect(bar).toBeVisible();
        await expect
          .poll(async () => {
            const a = await toast.boundingBox();
            const b = await bar.boundingBox();
            return !!a && !!b && a.y + a.height <= b.y;
          })
          .toBe(true);
      },
    }
  );
  await step(
    page,
    "bulk-categories-dialog",
    "Bulk selection: the Categories dialog",
    async () => {
      await page
        .getByRole("region", { name: "Selection", exact: true })
        .getByRole("button", { name: "Categories", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Categories", exact: true })
      ).toBeVisible();
    },
    chain
  );
  await page.keyboard.press("Escape");
  await step(
    page,
    "bulk-deleted-toast",
    "Bulk selection deleted: the toast with Undo",
    async () => {
      await page
        .getByRole("region", { name: "Selection", exact: true })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(
        page
          .locator("[data-sonner-toast]")
          .filter({ hasText: "Deleted" })
          .getByRole("button", { name: "Undo", exact: true })
      ).toBeVisible();
    },
    opts
  );
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Deleted" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();

  // Capture.
  await step(
    page,
    "capture-dialog",
    "Capture dialog, empty",
    async () => {
      await openWall();
      await page
        .getByRole("button", { name: "Capture", exact: true })
        .first()
        .click();
      await expect(page.getByRole("dialog", { name: "Capture" })).toBeVisible();
    },
    {
      ...chain,
      beforeShot: async () => {
        await expect(
          page.getByRole("dialog", { name: "Capture" })
        ).toHaveAttribute("data-presentation", "sheet");
      },
    }
  );
  await step(
    page,
    "capture-dialog-filled",
    "Capture dialog with a pasted link and a Capture Note",
    async () => {
      await page
        .getByRole("textbox", { name: "Text" })
        .fill("https://example.com/long-segment/".repeat(3));
      await page
        .getByRole("textbox", { name: "Capture Note" })
        .fill("For the weekend reading pile");
    },
    opts
  );
  await step(
    page,
    "capture-toast",
    "Captured toast with Undo, the Memory landing on the wall",
    async () => {
      await openWall();
      await paste(page, "Sunset over the dock, a note to remember");
      await expect(page.getByText("Captured")).toBeVisible();
    },
    opts
  );

  await step(
    page,
    "search-no-direct-matches",
    "Search with only Related Matches: No Direct Matches and the narrowing chips",
    async () => {
      await openWall();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search…").fill("sunrise");
      await page.waitForTimeout(900);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("list", { name: "Related Matches" })
      ).toBeVisible();
    },
    opts
  );
  await step(
    page,
    "search-more-like-this",
    "More Like This: Memories near one Memory, with its chip beside the filters",
    async () => {
      await open("Cardamom Buns");
      await page.getByRole("button", { name: "More Like This" }).click();
      await expect(
        page.getByRole("list", { name: "More Like This" })
      ).toBeVisible();
    },
    opts
  );
  await step(
    page,
    "filters-narrowed",
    "Kind and Category filters together with nothing left to show",
    async () => {
      await openWall();
      await page
        .getByRole("list", { name: "Kind" })
        .getByRole("button", { name: /PDF/ })
        .click();
      const categories = page.getByRole("list", {
        name: "Category",
        exact: true,
      });
      const recipe = categories.getByRole("button", {
        name: "Recipe",
        exact: true,
      });
      if (!(await recipe.isVisible()))
        await categories
          .getByRole("button", { name: "More", exact: true })
          .click();
      await recipe.click();
      await expect(
        page
          .getByRole("list", { name: "Kind" })
          .getByRole("button", { name: /PDF/ })
      ).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(800);
    },
    opts
  );

  // Categories.
  await step(
    page,
    "categories-manage",
    "Manage Categories dialog with the person's own Categories",
    async () => {
      await openWall();
      await page
        .getByRole("button", { name: "Manage Categories" })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Categories" });
      await expect(dialog).toBeVisible();
      for (const name of ["Garden Plans", "Reading Queue"]) {
        await dialog.getByLabel("Category Name").fill(name);
        await dialog.getByLabel("Category Name").press("Enter");
        await expect(dialog.getByText(name)).toBeVisible();
      }
    },
    opts
  );

  // Upload: an image on its way, slowed so the progress ring is on show.
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await context.route("**/api/local-files/**", async (route) => {
    await held;
    await route.fallback();
  });
  await step(
    page,
    "capture-upload-progress",
    "An image Capture uploading: the tile with its progress ring",
    async () => {
      await openWall();
      await page
        .getByRole("button", { name: "Capture", exact: true })
        .first()
        .click();
      const png = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 400;
        const g = canvas.getContext("2d")!;
        const gradient = g.createLinearGradient(0, 0, 600, 400);
        gradient.addColorStop(0, "#31748F");
        gradient.addColorStop(1, "#F6C177");
        g.fillStyle = gradient;
        g.fillRect(0, 0, 600, 400);
        return canvas.toDataURL("image/png").split(",")[1]!;
      });
      await page.getByLabel("Choose Files").setInputFiles({
        name: "harbour.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
      await expect(
        page.getByRole("progressbar", { name: "Uploading" })
      ).toBeVisible();
    },
    opts
  );
  release();

  expect(failures()).toEqual([]);
});

test("new account: Get Started, samples and the empty Library", async ({
  browser,
  page,
  context,
}) => {
  test.setTimeout(600_000);
  setSection("New Account");
  await signInFresh(page, "newcomer");
  const flow = page.getByRole("region", { name: "Get Started" });
  const chain = { recover: async () => {} };

  await step(
    page,
    "onboarding-disclosure",
    "Get Started, the AI-processing sentence over an empty Library",
    async () => {
      await page.goto("/");
      await expect(
        flow.getByText(/AI reads your Memories to make them Searchable/)
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-extension",
    "Get Started, Install Extension",
    async () => {
      await flow.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        flow.getByRole("link", { name: "Install Extension" })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-capture",
    "Get Started, Capture a Memory with ⌘V",
    async () => {
      await flow.getByRole("button", { name: "Next", exact: true }).click();
      await expect(
        flow.getByRole("heading", { name: "Capture a Memory" })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-paused",
    "Get Started paused: Resume in place of the steps",
    async () => {
      await flow.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(
        flow.getByRole("button", { name: "Resume", exact: true })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-indexing",
    "Get Started, Watch Indexing after a first Capture",
    async () => {
      await flow.getByRole("button", { name: "Resume", exact: true }).click();
      await paste(page, "My first Memory, a recipe for lemon cake");
      await expect(
        flow.getByRole("heading", { name: "Watch Indexing" })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-searchable",
    "Get Started, the first Memory Searchable and Try Search offered",
    async () => {
      await expect(flow.getByText("Searchable", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    },
    chain
  );
  await step(
    page,
    "onboarding-find",
    "Get Started, Find a Memory with Try a Vague Search",
    async () => {
      await flow.getByRole("button", { name: "Try Search" }).click();
      await expect(
        flow.getByRole("button", { name: "Try a Vague Search" })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-vague-search",
    "The vague search typed into ⌘K, finding a Sample by meaning",
    async () => {
      await flow.getByRole("button", { name: "Try a Vague Search" }).click();
      await expect(page.getByPlaceholder("Search…")).toHaveValue(
        "bookshop with a cat"
      );
      await expect(
        page
          .getByRole("listbox")
          .getByRole("option", { name: /A Quiet Place to Read/ })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-ready",
    "Get Started, Ready, with Samples wearing the Sample badge on the wall",
    async () => {
      await page
        .getByRole("listbox")
        .getByRole("option", { name: /A Quiet Place to Read/ })
        .click();
      await page.keyboard.press("Escape");
      await expect(flow.getByRole("heading", { name: "Ready" })).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "onboarding-remove-samples",
    "Get Started finished: Remove Samples offered above the wall",
    async () => {
      await flow.getByRole("button", { name: "Finish", exact: true }).click();
      await expect(
        flow.getByRole("button", { name: "Remove Samples" })
      ).toBeVisible();
    },
    chain
  );
  await step(
    page,
    "library-after-samples",
    "The wall after Remove Samples: only the person's own Memory is left",
    async () => {
      await flow.getByRole("button", { name: "Remove Samples" }).click();
      await expect(page.getByRole("listitem", { name: /Sample/ })).toHaveCount(
        0
      );
    },
    { recover: () => page.keyboard.press("Escape") }
  );

  // A Library with nothing in it, with Get Started over it and without.
  const empty: Mock = {
    memories: [],
    delay: 0,
    listFails: false,
    searchFails: false,
    answers: {},
    onboarding: {
      step: "disclosure",
      paused: false,
      samplesSeeded: false,
      firstSuccessfulSearchAt: null,
    },
  };
  await installLibrary(context, empty);
  await step(
    page,
    "library-empty-get-started",
    "An empty Library on its first visit: Get Started alone, with no heading under it",
    async () => {
      await page.goto("/");
      await expect(flow).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "No Memories Yet" })
      ).toBeHidden();
    }
  );
  await step(
    page,
    "library-empty",
    "An empty Library, Get Started finished: No Memories Yet with Capture and Search",
    async () => {
      empty.onboarding = FINISHED;
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "No Memories Yet" })
      ).toBeVisible();
    }
  );
  await step(
    page,
    "library-empty-search",
    "⌘K Search on an empty Library",
    async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search…").fill("anything");
      await expect(page.getByPlaceholder("Search…")).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  // A phone has no extension to install: Continue goes straight to Capture.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    deviceScaleFactor: 1,
  });
  try {
    const phonePage = await phone.newPage();
    await signInFresh(phonePage, "phone");
    const phoneFlow = phonePage.getByRole("region", { name: "Get Started" });
    await step(
      phonePage,
      "onboarding-phone",
      "Get Started on a phone: Continue goes straight to Capture, with no Install Extension step",
      async () => {
        await phonePage.goto("/");
        await phoneFlow
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await expect(
          phoneFlow.getByRole("heading", { name: "Capture a Memory" })
        ).toBeVisible();
        await expect(
          phoneFlow.getByRole("link", { name: "Install Extension" })
        ).toHaveCount(0);
      },
      { ...chain, sizes: [SIZES[1]] }
    );
  } finally {
    await phone.close();
  }
});

test("settings and admin", async ({ page, context }) => {
  test.setTimeout(600_000);
  setSection("Settings");
  await signInFresh(page, "settings");
  const origin = new URL(page.url()).origin;
  for (const body of [
    "Cardamom buns with orange zest",
    "Call the plumber before Friday",
    "Reading list: The Timeless Way of Building",
  ])
    await page.request.post("/api/memories", {
      headers: { Origin: origin },
      data: { id: crypto.randomUUID(), body, captureNote: null },
    });
  const chain = { recover: async () => {} };
  const full = { scrolled: true, recover: async () => {} };

  await step(
    page,
    "settings",
    "Settings, every section: Usage, Sessions, Connected Assistants, Import, Export, Account",
    async () => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Settings" })
      ).toBeVisible();
      await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-appearance",
    "Appearance setting with System, Light and Dark choices",
    async () => {
      await page
        .getByRole("radiogroup", { name: "Appearance" })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("radiogroup", { name: "Appearance" })
      ).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-assistants-token",
    "Connected Assistants: a new token shown once, to copy",
    async () => {
      await page.getByRole("button", { name: "Connect Assistant" }).click();
      await page.getByLabel("Assistant Name").fill("Claude Code");
      await page.getByRole("button", { name: "Create Token" }).click();
      await expect(page.getByLabel("Copy Token Now")).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-assistants-connected",
    "Connected Assistants: one assistant listed with Activity and Revoke",
    async () => {
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Connected Assistants" })
      ).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-assistants-guide",
    "Connection Guide dialog",
    async () => {
      await page.getByRole("button", { name: "Connection Guide" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  await step(
    page,
    "settings-assistants-activity",
    "Activity dialog of a connected assistant",
    async () => {
      await page
        .getByRole("button", { name: "Activity of Claude Code" })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  await step(
    page,
    "settings-assistants-revoke",
    "Revoke dialog, asking before an assistant is cut off",
    async () => {
      await page.getByRole("button", { name: "Revoke Claude Code" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  await step(
    page,
    "settings-import-progress",
    "Import in progress: Paused with its progress bar and counts",
    async () => {
      await page.getByLabel("Import File", { exact: true }).setInputFiles({
        name: "urls.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          Array.from(
            { length: 40 },
            (_, i) => `https://example.com/import-${i}`
          ).join("\n")
        ),
      });
      await expect(
        page.getByRole("progressbar", { name: "Import Progress" })
      ).toBeVisible();
      await page.getByRole("button", { name: "Pause Import" }).click();
      await expect(
        page.getByRole("button", { name: "Resume Import" })
      ).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-import-cancelled",
    "Import cancelled",
    async () => {
      await page.getByRole("button", { name: "Cancel Import" }).click();
      await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    },
    full
  );
  await step(
    page,
    "settings-export",
    "Export started: the Library being prepared, then Download",
    async () => {
      await page
        .getByRole("button", { name: /Export/ })
        .first()
        .click();
      await expect(
        page
          .getByRole("link", { name: /^Download/ })
          .or(page.getByText(/Preparing|Building/))
      ).toBeVisible({ timeout: 30_000 });
    },
    full
  );
  await step(
    page,
    "settings-delete-account",
    "Delete Account dialog: type the address to confirm",
    async () => {
      await page.getByRole("button", { name: "Delete Account" }).click();
      await expect(
        page.getByRole("dialog", { name: "Delete Account" })
      ).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  await step(
    page,
    "settings-delete-failed-toast",
    "Delete Did Not Finish, said beside the confirmation field after the server refused the deletion",
    async () => {
      await context.route("**/api/account", (route) =>
        route.request().method() === "DELETE"
          ? route.fulfill({ status: 500, json: {} })
          : route.fallback()
      );
      const dialog = page.getByRole("dialog", { name: "Delete Account" });
      await page.getByRole("button", { name: "Delete Account" }).click();
      const email = (await dialog.locator("label span").innerText()).trim();
      await dialog.getByRole("textbox").fill(email);
      await dialog.getByRole("button", { name: "Delete Account" }).click();
      await expect(dialog.getByText("Delete Did Not Finish")).toBeVisible();
    },
    { recover: () => page.keyboard.press("Escape") }
  );
  await context.unroute("**/api/account");
  await step(
    page,
    "settings-unreachable",
    "Settings Are Unreachable with Try Again",
    async () => {
      await context.route("**/api/usage", (route) => route.abort());
      await context.route("**/api/account/sessions", (route) => route.abort());
      await page.goto("/settings");
      await expect(page.getByText("Settings Are Unreachable")).toBeVisible();
    },
    chain
  );
  await context.unroute("**/api/usage");
  await context.unroute("**/api/account/sessions");

  // Admin, as the local admin address.
  await context.clearCookies();
  await signIn(page, "admin@example.test");
  await step(
    page,
    "admin",
    "Admin: Daily Budget and the owner's numbers",
    async () => {
      await page.getByRole("link", { name: "Admin" }).click();
      await expect(
        page.getByRole("heading", { name: "Daily Budget" })
      ).toBeVisible();
    },
    full
  );
});

test("share target and offline page", async ({ page }) => {
  test.setTimeout(240_000);
  setSection("Share Target");
  await signInFresh(page, "share");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const ready = reg?.active ? reg : await navigator.serviceWorker.ready;
        return Boolean(ready.active && navigator.serviceWorker.controller);
      })
    )
    .toBe(true);
  await step(
    page,
    "share-captured",
    "A share from the Android share sheet Captured: the Memory on the wall with its toast",
    async () => {
      await page.evaluate(() => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/share";
        form.enctype = "multipart/form-data";
        for (const [name, value] of [
          ["title", "Garden notes"],
          ["text", "Shared from the share sheet: basil likes a south window"],
        ]) {
          const input = document.createElement("input");
          input.name = name!;
          input.value = value!;
          form.append(input);
        }
        document.body.append(form);
        form.submit();
      });
      await expect(
        page
          .getByRole("listitem", { name: /Shared from the share sheet/ })
          .or(page.getByRole("listitem", { name: /Garden notes/ }))
      ).toBeVisible();
      await expect(page.getByText("Captured")).toBeVisible();
    }
  );
  await step(
    page,
    "offline",
    "Spark Is Offline, the page the service worker shows with no connection",
    async () => {
      await page.context().setOffline(true);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Spark Is Offline" })
      ).toBeVisible();
    },
    { recover: () => page.context().setOffline(false) }
  );
});

/**
 * The popup's own font, not the browser's for extension pages: Chrome sets
 * `body { font-family: system }` there, and the popup's stylesheet must win.
 */
async function expectPopupFont(popup: Page) {
  await popup.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      popup.evaluate(() => getComputedStyle(document.body).fontFamily)
    )
    .toMatch(/^"?Instrument Sans/);
}

test("extension popup, Grant Access and region overlay", async () => {
  test.setTimeout(420_000);
  setSection("Browser Extension");
  const origin = `http://localhost:${process.env.SPARK_WEB_PORT ?? 5173}`;
  execFileSync("pnpm", ["--filter", "@spark/extension", "build"], {
    cwd: resolve("../.."),
    env: { ...process.env, WXT_E2E: "1", WXT_API_ORIGIN: origin },
    stdio: "ignore",
  });
  const profile = await mkdtemp(resolve(tmpdir(), "spark-tour-extension-"));
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
    const fixture = await context.newPage();
    await fixture.route("https://fixture.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><title>Growing Basil</title></head><body style="font:16px system-ui;margin:40px;max-width:640px"><article><h1>Growing Basil</h1><p>${"Basil wants six hours of sunlight and warm soil. ".repeat(30)}</p></article></body></html>`,
      })
    );
    await fixture.setViewportSize({ width: 1280, height: 720 });
    await fixture.goto("https://fixture.test/basil");
    const popup = await context.newPage();
    const open = async () => {
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await fixture.bringToFront();
      await popup.reload();
      await fixture.bringToFront();
    };
    await step(
      popup,
      "extension-popup-signed-out",
      "Extension popup before sign-in: Sign In and Try Again",
      async () => {
        await open();
        await expectPopupFont(popup);
        await expect(popup.getByRole("status")).toHaveText("Sign In");
      },
      { recover: async () => {}, sizes: POPUP, fitContent: true }
    );
    const dashboard = await context.newPage();
    await signInFresh(dashboard, "extension");
    await step(
      popup,
      "extension-popup-saved",
      "Extension popup after saving the page, with the Capture Note field",
      async () => {
        await open();
        await expectPopupFont(popup);
        await expect(popup.getByRole("status")).toHaveText(
          /Captured|Already in Your Library/
        );
        // The captured title shows under the status.
        await expect(popup.locator(".memory-title")).toBeVisible();
      },
      { recover: async () => {}, sizes: POPUP, fitContent: true }
    );
    await step(
      popup,
      "extension-popup-note",
      "Extension popup with a Capture Note typed",
      async () => {
        await popup
          .getByRole("textbox", { name: "Capture Note" })
          .fill("For the balcony box");
      },
      { recover: async () => {}, sizes: POPUP, fitContent: true }
    );
    await step(
      popup,
      "extension-popup-queued",
      "Extension popup offline: Waiting to Send, with Try Again and Discard Outbox",
      async () => {
        await context.setOffline(true);
        await fixture.goto("https://fixture.test/basil-offline");
        await popup.reload();
        await fixture.bringToFront();
        await expect(popup.getByRole("status")).toHaveText("Waiting to Send");
      },
      {
        recover: () => context.setOffline(false),
        sizes: POPUP,
        fitContent: true,
      }
    );
    const grantId = "permission-tour";
    await worker.evaluate(async (grantId) => {
      const chrome = (
        globalThis as unknown as {
          chrome: {
            tabs: { query(q: unknown): Promise<{ id: number }[]> };
            storage: { session: { set(value: unknown): Promise<void> } };
          };
        }
      ).chrome;
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.storage.session.set({
        permissionCapture: {
          id: grantId,
          mode: "selection",
          tabId: tab!.id,
          frameId: 0,
          origin: "https://fixture.test",
          expiresAt: Date.now() + 600_000,
        },
      });
    }, grantId);
    const permission = await context.newPage();
    await step(
      permission,
      "extension-grant-access",
      "Extension Grant Access page, asking for the site before saving a selection",
      async () => {
        await permission.goto(
          `chrome-extension://${id}/permission.html#${grantId}`
        );
        await expect(
          permission.getByRole("button", { name: "Grant Access" })
        ).toBeEnabled();
      },
      { recover: async () => {} }
    );
    await permission.close();
    await fixture.bringToFront();
    await fixture.goto("https://fixture.test/basil");
    await step(
      fixture,
      "extension-region-overlay",
      "Extension region capture: dragging a rectangle over the page",
      async () => {
        await popup.evaluate(
          () =>
            void (
              globalThis as unknown as {
                chrome: {
                  runtime: { sendMessage(m: unknown): Promise<unknown> };
                };
              }
            ).chrome.runtime.sendMessage({ type: "region" })
        );
        await expect
          .poll(() =>
            fixture.evaluate(
              () =>
                !!document.documentElement.querySelector(
                  '[style*="2147483647"]'
                )
            )
          )
          .toBe(true);
        await fixture.mouse.move(120, 140);
        await fixture.mouse.down();
        await fixture.mouse.move(560, 400, { steps: 4 });
      },
      // The overlay is a desktop page's: no phone variant.
      { recover: () => fixture.keyboard.press("Escape"), sizes: [SIZES[0]] }
    );
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

/**
 * Short videos of the micro-interactions, each in its own recorded context
 * on the fixed Library. A small ring follows the pointer, since a headless
 * browser draws none.
 */
test("videos of the micro-interactions", async ({ browser, page }) => {
  test.setTimeout(600_000);
  setSection("Videos");
  await signInFresh(page, "videos");
  const state = await page.context().storageState();
  const memories = tourMemories();
  const kinds = pick(memories);
  const mock: Mock = {
    memories,
    delay: 0,
    listFails: false,
    searchFails: false,
    onboarding: FINISHED,
    answers: {
      garden: {
        direct: [kinds.pdf.id, kinds.longNote.id],
        related: [kinds.image.id, kinds.video.id, kinds.link.id],
      },
    },
  };
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

  async function film(
    name: string,
    line: string,
    size: { width: number; height: number },
    script: (page: Page) => Promise<void>,
    colorScheme: "light" | "dark" = "light"
  ) {
    const context = await browser.newContext({
      storageState: state,
      viewport: size,
      colorScheme,
      recordVideo: { dir: resolve(VIDEOS, ".raw"), size },
    });
    await installLibrary(context, mock);
    const filmed = await context.newPage();
    await withCursor(filmed);
    try {
      await filmed.goto("/");
      await expect(
        filmed.getByRole("list", { name: "All Memories" })
      ).toBeVisible({
        timeout: 30_000,
      });
      await filmed.mouse.move(size.width / 2, size.height / 2);
      await wait(700);
      await script(filmed);
      await wait(700);
    } finally {
      const video = filmed.video();
      await context.close();
      await video?.saveAs(resolve(VIDEOS, name));
      recordVideo(name, line);
    }
  }
  const desktop = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };
  const move = (p: Page, x: number, y: number) =>
    p.mouse.move(x, y, { steps: 18 });

  await film(
    "memory-open-close-desktop.webm",
    "Opening a note and an image from the wall and closing them with Escape and the close button, desktop",
    desktop,
    async (p) => {
      await tile(p, "Cardamom Buns").click();
      await wait(1400);
      await p.keyboard.press("Escape");
      await wait(900);
      await tile(p, "Harbour at Dusk").click();
      await wait(1400);
      await p.keyboard.press("Escape");
      await wait(600);
    }
  );
  await film(
    "memory-open-close-phone.webm",
    "Opening a Memory and closing it on a phone",
    phone,
    async (p) => {
      await tile(p, "Cardamom Buns").click();
      await wait(1400);
      await p.keyboard.press("Escape");
      await wait(900);
    }
  );
  await film(
    "command-menu-typing.webm",
    "Typing in ⌘K: instant results per keystroke, full results after a pause, Enter putting them on the wall",
    desktop,
    async (p) => {
      await p.keyboard.press("ControlOrMeta+k");
      await wait(600);
      await p
        .getByPlaceholder("Search…")
        .pressSequentially("garden", { delay: 220 });
      await wait(1800);
      await p.keyboard.press("Enter");
      await wait(1800);
    }
  );
  await film(
    "tile-hover-press.webm",
    "Hover and press on tiles, the Capture button and sidebar items",
    desktop,
    async (p) => {
      for (const name of [
        "Cardamom Buns",
        "Harbour at Dusk",
        "The Case for Keeping Everything",
      ]) {
        const box = (await tile(p, name).boundingBox())!;
        await move(p, box.x + box.width / 2, box.y + box.height / 2);
        await wait(500);
        await p.mouse.down();
        await wait(450);
        await p.mouse.up();
        await p.keyboard.press("Escape");
        await wait(400);
      }
      const capture = (await p
        .getByRole("button", { name: "Capture", exact: true })
        .first()
        .boundingBox())!;
      await move(
        p,
        capture.x + capture.width / 2,
        capture.y + capture.height / 2
      );
      await wait(500);
      await p.mouse.down();
      await wait(450);
      await p.mouse.up();
      await wait(700);
      await p.keyboard.press("Escape");
      for (const name of ["Images", "Notes"]) {
        const item = (await p
          .getByRole("list", { name: "Kind" })
          .getByRole("button", { name })
          .boundingBox())!;
        await move(p, item.x + item.width / 2, item.y + item.height / 2);
        await wait(450);
      }
    }
  );
  await film(
    "bulk-select.webm",
    "Selecting in bulk: ⌘-click, Shift-click a range, the selection bar rising, Escape clearing it",
    desktop,
    async (p) => {
      await tile(p, "Cardamom Buns").click({ modifiers: ["ControlOrMeta"] });
      await wait(700);
      await tile(p, "Harbour at Dusk").click();
      await wait(600);
      await tile(p, "Reading List").click({ modifiers: ["Shift"] });
      await wait(1300);
      await p.keyboard.press("Escape");
      await wait(800);
    }
  );
  await film(
    "toast-appearing.webm",
    "A Capture landing on the wall and its Captured toast appearing, then the Delete toast with Undo",
    desktop,
    async (p) => {
      await paste(p, "A note pasted while the camera rolls");
      await wait(2600);
      await tile(p, "Cardamom Buns").click({ modifiers: ["ControlOrMeta"] });
      await p
        .getByRole("region", { name: "Selection", exact: true })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await wait(2200);
      await p
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Deleted" })
        .getByRole("button", { name: "Undo", exact: true })
        .click();
      await wait(800);
    }
  );
  await film(
    "dialog-open-close-light-dark.webm",
    "The Capture dialog opening and closing in light, then in dark",
    desktop,
    async (p) => {
      const capture = p
        .getByRole("button", { name: "Capture", exact: true })
        .first();
      await capture.click();
      await wait(1100);
      await p.keyboard.press("Escape");
      await wait(700);
      await p.emulateMedia({ colorScheme: "dark" });
      await wait(700);
      await capture.click();
      await wait(1100);
      await p.keyboard.press("Escape");
      await wait(600);
    }
  );
  await film(
    "sidebar-navigation.webm",
    "Sidebar navigation: kind filters, All Memories, then Settings and back to the Library",
    desktop,
    async (p) => {
      const kind = (name: string) =>
        p.getByRole("list", { name: "Kind" }).getByRole("button", { name });
      for (const name of ["Images", "PDFs", "Videos", "Links", "Notes"]) {
        await kind(name).click();
        await wait(900);
      }
      await p
        .getByRole("link", { name: "All Memories" })
        .or(p.getByRole("button", { name: "All Memories" }))
        .first()
        .click();
      await wait(900);
      await p.getByRole("link", { name: "Settings" }).click();
      await expect(p.getByRole("heading", { name: "Settings" })).toBeVisible();
      await wait(1400);
      await p.getByRole("link", { name: "All Memories" }).click();
      await wait(1200);
    }
  );
  await rm(resolve(VIDEOS, ".raw"), { recursive: true, force: true });
});

test.afterAll(() => {
  const { missing } = writeIndex();
  expect(missing).toEqual([]);
  expect(failures().map((f) => f.slug)).toEqual([]);
});
