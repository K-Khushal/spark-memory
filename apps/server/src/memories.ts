import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import {
  AiOptOut,
  EMBEDDING,
  embeddingSpace,
  FREE_ALLOWANCE,
  ImageCapture,
  LinkCapture,
  MemoryEditRequest,
  PdfCapture,
  SCREENSHOT_MAX_BYTES,
  SearchEvent,
  SearchRequest,
  TextCapture,
} from "@spark/core";
import {
  indexingStore,
  openCategories,
  openLibrary,
  type FileUpload,
  type Library,
  type Memory,
} from "@spark/db";
import { embedderFor } from "@spark/indexing";
import { createSearch } from "@spark/search";
import type { AppEnv } from "./env";
import { requireUser, withAuth, type UserVariables } from "./auth";
import {
  FILE_CACHE_CONTROL,
  fileStore,
  forClient,
  type FileStore,
} from "./files";
import { extensionCors, sameOrigin } from "./origin";
import { enqueueDeepFetch } from "./deep-fetch-queue";
import { enqueue, enqueueEmbed, providers } from "./indexing";

/** Bound screenshot storage calls; cleanup stays durable if a PUT finishes late. */
async function screenshotStorage<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("screenshot storage timeout")),
          10_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The signed-in person's Library, for every route below. */
const withLibrary = createMiddleware<
  AppEnv & { Variables: UserVariables & { library: Library } }
>(async (c, next) => {
  const embedder = embedderFor(providers(c.env));
  c.set(
    "library",
    openLibrary(c.var.db, c.var.user.id, {
      ...(embedder && {
        vectorsSpace: embeddingSpace(embedder.model, embedder.dimensions),
      }),
    })
  );
  await next();
});

/** The person's search: instant, full (with their query embedded) and More Like This. */
const searchFor = (
  env: AppEnv["Bindings"],
  db: Parameters<typeof indexingStore>[0],
  userId: string,
  library: Library
) => {
  const embedder = embedderFor(providers(env));
  return createSearch({
    userId,
    find: library.search,
    ...(embedder && { embedder }),
    spend: indexingStore(db),
  });
};

/** Memory files in storage, signed for this request. */
const withFiles = createMiddleware<
  AppEnv & { Variables: { files: FileStore } }
>(async (c, next) => {
  c.set("files", fileStore(c.env, c.req.url));
  await next();
});

/** Answers carry one person's Memories and signed URLs: never cached anywhere. */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
});

/** JSON validated by a @spark/core schema; 400 with no detail otherwise. */
export const json = <T>(schema: {
  safeParse: (
    value: unknown
  ) => { success: true; data: T } | { success: false };
}) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? parsed.data
      : c.json({ ok: false, error: "invalid" } as const, 400);
  });

// Every text field at 4 bytes a character (UTF-8 plus JSON escapes), with room
// for the keys: anything bigger cannot be valid, so it is never read.
const MAX_BODY_BYTES =
  4 *
    (FREE_ALLOWANCE.textMaxChars +
      FREE_ALLOWANCE.titleMaxChars +
      FREE_ALLOWANCE.captureNoteMaxChars +
      2000) +
  8192;
const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

/** At most this many Memories per poll; the wall polls the ones it shows Indexing. */
const MAX_POLLED = 100;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const notFound = { ok: false, error: "not_found" } as const;

const limitImageBody = bodyLimit({
  maxSize: 4096,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});
/** A search: the words (up to 2,000 characters, in any script) and a few chips. */
const limitSearchBody = bodyLimit({
  maxSize: 16_384,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});
/** A PDF Capture describes up to 30 page images too. */
const limitPdfBody = bodyLimit({
  maxSize: 16_384,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

/** A new file Memory as the browser gets it, with where to PUT each file. */
const signedCapture = async (
  files: FileStore,
  result: { memory: Memory; uploads: FileUpload[] }
) => {
  const [memory, uploads] = await Promise.all([
    forClient(files, result.memory),
    Promise.all(
      result.uploads.map(async (u) => ({
        role: u.role,
        page: u.page,
        ...(await files.signUpload(u)),
      }))
    ),
  ]);
  return { memory, uploads };
};

/** A Memory's files; undefined for an id that is not one of the owner's. */
const filesOf = async (library: Library, id: string) =>
  UUID.test(id) ? library.files(id) : undefined;

export const signedIn = [
  extensionCors,
  sameOrigin({ extension: true }),
  withAuth,
  requireUser,
  createMiddleware<AppEnv & { Variables: UserVariables }>(async (c, next) => {
    const owner = c.req.header("x-spark-user");
    if (owner && owner !== c.var.user.id) {
      return c.json({ ok: false, error: "account_changed" } as const, 409);
    }
    return next();
  }),
  withLibrary,
  withFiles,
  noStore,
] as const;

const limitScreenshot = bodyLimit({
  maxSize: SCREENSHOT_MAX_BYTES,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

const dimension = (value: string | undefined) => {
  if (!value || !/^\d{1,4}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 && n <= 8000 ? n : undefined;
};

/** The Memory API (Capture, read, edit, delete, instant search), signed in only. */
export const memories = new Hono<AppEnv>()
  .use("/memories/*", ...signedIn)
  .use("/memories", ...signedIn)
  .use("/search", ...signedIn)
  .use("/search/*", ...signedIn)
  .use("/storage", ...signedIn)
  .get("/memories", async (c) => {
    // `ids`: just these Memories, for the dashboard's poll while they Index.
    const ids = c.req.query("ids");
    if (ids !== undefined) {
      const wanted = ids.split(",").filter((id) => UUID.test(id));
      if (wanted.length > MAX_POLLED) {
        return c.json({ ok: false, error: "invalid" } as const, 400);
      }
      const found = await c.var.library.getMany(wanted);
      return c.json({
        memories: await Promise.all(
          found.map((m) => forClient(c.var.files, m))
        ),
        unfinished: [],
      });
    }
    const after = c.req.query("after");
    const page = await c.var.library.list(after ? { after } : {});
    if (!page) return c.json({ ok: false, error: "invalid" } as const, 400);
    const signed = (all: typeof page.memories) =>
      Promise.all(all.map((m) => forClient(c.var.files, m)));
    // The first page also carries uploads a closed page left unfinished
    // once their PUT has expired, apart from the wall, so they can be
    // deleted before the sweep. A younger one stays off this list: another
    // tab may still be uploading it.
    const [memories, unfinished] = await Promise.all([
      signed(page.memories),
      after ? [] : c.var.library.unfinished().then(signed),
    ]);
    return c.json({ ...page, memories, unfinished });
  })
  .post("/memories", limitBody, json(TextCapture), async (c) => {
    const result = await c.var.library.capture(c.req.valid("json"));
    if ("conflict" in result) {
      return c.json({ ok: false, error: "conflict" } as const, 409);
    }
    // A retry of a Capture still Indexing enqueues again: duplicates are harmless.
    if (result.memory.indexState === "indexing") {
      await enqueue(c.env, result.memory);
    }
    const memory = await forClient(c.var.files, result.memory);
    return c.json(memory, result.created ? 201 : 200);
  })
  /**
   * A pasted link: the Memory at once (201), Indexing gathers its Source.
   * The same page again answers 200 with the Memory already saved, moved
   * to the top; its id differs from the one sent, which is how the
   * dashboard tells it apart from a retry of this Capture.
   */
  .post("/memories/links", limitBody, json(LinkCapture), async (c) => {
    const result = await c.var.library.captureLink(c.req.valid("json"));
    if ("conflict" in result) {
      return c.json({ ok: false, error: "conflict" } as const, 409);
    }
    if (
      result.memory.indexState === "indexing" &&
      (!result.duplicate || result.indexAgain)
    ) {
      await enqueue(c.env, result.memory);
    }
    const memory = await forClient(c.var.files, result.memory);
    return c.json(memory, result.created ? 201 : 200);
  })
  /**
   * The extension's visible-area screenshot, already a small JPEG. The
   * bytes are stored and the file row is written as stored in this
   * request, so a lost upload cannot leave an unstored file (that would
   * hide the link, and the sweep would delete it). A second send is a
   * no-op once one is kept.
   */
  .get("/memories/:id/screenshot", async (c) => {
    const files = await filesOf(c.var.library, c.req.param("id"));
    const file = files?.find((file) => file.role === "screenshot");
    return file
      ? c.json({ url: await c.var.files.signDownload(file.key) })
      : c.json(notFound, 404);
  })
  .post("/memories/:id/screenshot", limitScreenshot, async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json(notFound, 404);
    const type = c.req.header("content-type")?.split(";")[0]?.trim();
    if (type !== "image/jpeg") {
      return c.json({ ok: false, error: "invalid" } as const, 400);
    }
    const body = await c.req.arrayBuffer();
    const bytes = new Uint8Array(body);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return c.json({ ok: false, error: "invalid" } as const, 400);
    }
    const slot = await c.var.library.prepareScreenshot(id, bytes.byteLength);
    if (!slot) return c.json(notFound, 404);
    if ("refused" in slot) {
      return c.json({ ok: false, error: slot.refused } as const, 413);
    }
    if ("already" in slot) return c.json({ ok: true } as const);
    try {
      await screenshotStorage(
        c.env.FILES.put(slot.key, body, {
          httpMetadata: {
            contentType: "image/jpeg",
            cacheControl: FILE_CACHE_CONTROL,
          },
        })
      );
    } catch {
      return c.json({ ok: false, error: "unavailable" } as const, 503);
    }
    const recorded = await c.var.library.recordScreenshot(id, {
      key: slot.key,
      bytes: bytes.byteLength,
      width: dimension(c.req.header("x-spark-width")),
      height: dimension(c.req.header("x-spark-height")),
    });
    if (!recorded) {
      await screenshotStorage(c.env.FILES.delete(slot.key));
      return c.json({ ok: false, error: "unavailable" } as const, 503);
    }
    return c.json({ ok: true } as const);
  })
  /**
   * Step one of an image Capture: the Memory is created (within the Free
   * allowance) and the browser gets a presigned PUT per file still missing.
   */
  .post("/memories/images", limitImageBody, json(ImageCapture), async (c) => {
    const result = await c.var.library.captureImage(c.req.valid("json"));
    if ("conflict" in result) {
      return c.json({ ok: false, error: "conflict" } as const, 409);
    }
    if ("refused" in result) {
      return c.json({ ok: false, error: result.refused } as const, 413);
    }
    const { memory, uploads } = await signedCapture(c.var.files, result);
    return c.json({ memory, uploads }, result.created ? 201 : 200);
  })
  /**
   * Step one of a PDF Capture, as for an image: the Memory, and a
   * presigned PUT for the PDF, its thumbnail and each Indexed page's image.
   * Step two is the same `stored`.
   */
  .post("/memories/pdfs", limitPdfBody, json(PdfCapture), async (c) => {
    const result = await c.var.library.capturePdf(c.req.valid("json"));
    if ("conflict" in result) {
      return c.json({ ok: false, error: "conflict" } as const, 409);
    }
    if ("refused" in result) {
      return c.json({ ok: false, error: result.refused } as const, 413);
    }
    const { memory, uploads } = await signedCapture(c.var.files, result);
    return c.json({ memory, uploads }, result.created ? 201 : 200);
  })
  /** A PDF's page images for the viewer, signed, in order. */
  .get("/memories/:id/pages", async (c) => {
    const id = c.req.param("id");
    const pages = UUID.test(id)
      ? await c.var.library.pageImages(id)
      : undefined;
    if (!pages) return c.json(notFound, 404);
    return c.json({
      pages: await Promise.all(
        pages.map(async ({ key, ...page }) => ({
          ...page,
          url: await c.var.files.signDownload(key),
        }))
      ),
    });
  })
  /** Step two: the files are checked in storage, and the Memory shows. */
  .post("/memories/:id/stored", async (c) => {
    const id = c.req.param("id");
    const memory = UUID.test(id)
      ? await c.var.library.markStored(id, c.var.files.check)
      : undefined;
    if (!memory) return c.json(notFound, 404);
    if (memory === "mismatch") {
      return c.json({ ok: false, error: "mismatch" } as const, 422);
    }
    if (memory === "missing" || memory === "expired") {
      return c.json({ ok: false, error: "not_uploaded" } as const, 409);
    }
    if (memory.indexState === "indexing") {
      await enqueue(c.env, memory);
    }
    return c.json(await forClient(c.var.files, memory));
  })
  /** Retry on a Failed Memory: Indexing again, first in line once a day. */
  .post("/memories/:id/reindex", async (c) => {
    const id = c.req.param("id");
    const memory = UUID.test(id) && (await c.var.library.retryIndexing(id));
    if (!memory) return c.json(notFound, 404);
    if (memory.indexState === "indexing") {
      await enqueue(c.env, memory);
    }
    return c.json(await forClient(c.var.files, memory));
  })
  /**
   * Try Again on a Memory whose Deep fetch Failed or was Unavailable: a new
   * run, with all its automatic attempts, sent at once.
   */
  .post("/memories/:id/deep-fetch", async (c) => {
    const id = c.req.param("id");
    const before = UUID.test(id) && (await c.var.library.get(id));
    const memory = before && (await c.var.library.retryDeepFetch(id));
    if (!memory) return c.json(notFound, 404);
    // Only a run just started is sent; any other Memory comes back as it is.
    if (
      memory.deepFetchRun !== before.deepFetchRun &&
      memory.deepFetch === "fetching"
    ) {
      await enqueueDeepFetch(c.env, {
        memoryId: memory.id,
        generation: memory.indexGeneration,
        run: memory.deepFetchRun,
      });
    }
    return c.json(await forClient(c.var.files, memory));
  })
  /** AI opt-out (ADR-0011): on, nothing more goes to a provider; off, Indexing again. */
  .put("/memories/:id/ai-opt-out", json(AiOptOut), async (c) => {
    const id = c.req.param("id");
    const { aiOptOut } = c.req.valid("json");
    const memory =
      UUID.test(id) && (await c.var.library.setAiOptOut(id, aiOptOut));
    if (!memory) return c.json(notFound, 404);
    if (!aiOptOut && memory.indexState === "indexing") {
      await enqueue(c.env, memory);
    }
    return c.json(await forClient(c.var.files, memory));
  })
  .get("/storage", async (c) =>
    c.json({
      usedBytes: await c.var.library.usedStorage(),
      limitBytes: FREE_ALLOWANCE.storageBytes,
    })
  )
  .get("/memories/:id", async (c) => {
    const id = c.req.param("id");
    const memory = UUID.test(id) && (await c.var.library.get(id));
    return memory
      ? c.json(await forClient(c.var.files, memory))
      : c.json(notFound, 404);
  })
  .patch("/memories/:id", limitBody, json(MemoryEditRequest), async (c) => {
    const id = c.req.param("id");
    const { revision, ...changes } = c.req.valid("json");
    const result =
      UUID.test(id) && (await c.var.library.edit(id, changes, revision));
    if (!result) return c.json(notFound, 404);
    if ("stale" in result) {
      return c.json({ ok: false, error: "stale" } as const, 409);
    }
    if ("unknownCategory" in result) {
      return c.json({ ok: false, error: "unknown_category" } as const, 400);
    }
    // New text is Indexed again, behind fresh Captures.
    if (changes.body !== undefined && result.indexState === "indexing") {
      await enqueue(c.env, result);
    } else if (
      (changes.title !== undefined || changes.captureNote !== undefined) &&
      result.indexState === "searchable" &&
      !result.aiOptOut
    ) {
      // Its vectors read the title and note: made again once typing stops.
      await enqueueEmbed(c.env, result, EMBEDDING.editDelaySeconds);
    }
    return c.json(await forClient(c.var.files, result));
  })
  /** Permanent: the files go from storage first, then the Memory. */
  .delete("/memories/:id", async (c) => {
    const id = c.req.param("id");
    const files = await filesOf(c.var.library, id);
    if (!files) return c.json(notFound, 404);
    await c.var.files.remove(files.map((f) => f.key));
    const removed = await c.var.library.remove(id);
    return removed ? c.body(null, 204) : c.json(notFound, 404);
  })
  /**
   * `mode=full` (after a pause in typing) embeds the query for the vector
   * leg; instant (per keystroke) is keyword and typo only. Each result says
   * whether it is a Direct or Related Match and which part matched.
   */
  .post("/search", limitSearchBody, json(SearchRequest), async (c) => {
    // A POST, so what was typed and chosen is in the body, never in a URL
    // that a request log keeps.
    const { q, mode, timezone, chips, page } = c.req.valid("json");
    // A Category chip is a built-in or the person's own, never another's.
    if (
      chips?.category &&
      !(await openCategories(c.var.db, c.var.user.id).has(chips.category))
    ) {
      return c.json({ ok: false, error: "unknown_category" } as const, 400);
    }
    const answer = await searchFor(
      c.env,
      c.var.db,
      c.var.user.id,
      c.var.library
    ).search(q, mode, {
      ...(timezone && { timezone }),
      ...(chips && { chips }),
      ...(page && { page }),
    });
    return c.json({
      // "instant" when full mode fell back (no embedder, budget, provider).
      mode: answer.mode,
      results: await Promise.all(
        answer.results.map((m) => forClient(c.var.files, m))
      ),
      // Where the next page begins, when there is one.
      ...(answer.next && { next: answer.next }),
    });
  })
  /** Recent searches, newest first. */
  .get("/search/recent", async (c) =>
    c.json({ searches: await c.var.library.recentSearches() })
  )
  .delete("/search/recent", async (c) => {
    await c.var.library.forgetSearch();
    return c.body(null, 204);
  })
  .delete("/search/recent/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "invalid_id" }, 400);
    await c.var.library.forgetSearch(id);
    return c.body(null, 204);
  })
  /** A committed search, or a click on one of its results (Recent searches, PRD metrics). */
  .post("/search/events", limitImageBody, json(SearchEvent), async (c) => {
    const { query, memoryId, position, reformulation } = c.req.valid("json");
    await c.var.library.rememberSearch(
      query,
      memoryId && position ? { memoryId, position } : undefined,
      reformulation
    );
    return c.body(null, 204);
  })
  /** More Like This: Memories near this one's own vectors, leaving it out. */
  .get("/memories/:id/similar", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id) || !(await c.var.library.get(id))) {
      return c.json(notFound, 404);
    }
    const results = await searchFor(
      c.env,
      c.var.db,
      c.var.user.id,
      c.var.library
    ).similar(id);
    return c.json({
      results: await Promise.all(results.map((m) => forClient(c.var.files, m))),
    });
  });
