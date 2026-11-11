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
  MemoryEditRequest,
  TextCapture,
} from "@spark/core";
import { indexingStore, openLibrary, type Library } from "@spark/db";
import { embedderFor } from "@spark/indexing";
import { createSearch } from "@spark/search";
import type { AppEnv } from "./env";
import { requireUser, withAuth, type UserVariables } from "./auth";
import { fileStore, forClient, type FileStore } from "./files";
import { sameOrigin } from "./origin";
import { enqueue, enqueueEmbed, providers } from "./indexing";

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
      FREE_ALLOWANCE.captureNoteMaxChars) +
  4096;
const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

/** Longer queries are cut: nobody types more to find a Memory. */
const MAX_QUERY_CHARS = 300;

/** At most this many Memories per poll; the wall polls the ones it shows Indexing. */
const MAX_POLLED = 100;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const notFound = { ok: false, error: "not_found" } as const;

const limitImageBody = bodyLimit({
  maxSize: 4096,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

/** A Memory's files; undefined for an id that is not one of the owner's. */
const filesOf = async (library: Library, id: string) =>
  UUID.test(id) ? library.files(id) : undefined;

const signedIn = [
  sameOrigin,
  withAuth,
  requireUser,
  withLibrary,
  withFiles,
  noStore,
] as const;

/** The Memory API (Capture, read, edit, delete, instant search), signed in only. */
export const memories = new Hono<AppEnv>()
  .use("/memories/*", ...signedIn)
  .use("/memories", ...signedIn)
  .use("/search", ...signedIn)
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
    // The first page also carries uploads a closed page left unfinished,
    // apart from the wall, so they can be deleted before the sweep.
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
    const { files } = c.var;
    const [memory, uploads] = await Promise.all([
      forClient(files, result.memory),
      Promise.all(
        result.uploads.map(async (u) => ({
          role: u.role,
          ...(await files.signUpload(u)),
        }))
      ),
    ]);
    return c.json({ memory, uploads }, result.created ? 201 : 200);
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
  .get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").slice(0, MAX_QUERY_CHARS);
    const mode = c.req.query("mode") === "full" ? "full" : "instant";
    const results = await searchFor(
      c.env,
      c.var.db,
      c.var.user.id,
      c.var.library
    ).search(q, mode);
    return c.json({
      // "instant" when full mode fell back (no embedder, budget, provider).
      mode: results.mode,
      results: await Promise.all(
        results.results.map((m) => forClient(c.var.files, m))
      ),
    });
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
