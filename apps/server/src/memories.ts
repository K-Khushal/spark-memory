import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { FREE_ALLOWANCE, MemoryEdit, TextCapture } from "@spark/core";
import { openLibrary, type Library } from "@spark/db";
import type { AppEnv } from "./env";
import { requireUser, withAuth, type UserVariables } from "./auth";

/** The signed-in person's Library, for every route below. */
const withLibrary = createMiddleware<
  AppEnv & { Variables: UserVariables & { library: Library } }
>(async (c, next) => {
  c.set("library", openLibrary(c.var.db, c.var.user.id));
  await next();
});

/** JSON validated by a @spark/core schema; 400 with no detail otherwise. */
const json = <T>(schema: {
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

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const notFound = { ok: false, error: "not_found" } as const;

/** The Memory API (Capture, read, edit, delete, instant search), signed in only. */
export const memories = new Hono<AppEnv>()
  .use("/memories/*", withAuth, requireUser, withLibrary)
  .use("/memories", withAuth, requireUser, withLibrary)
  .use("/search", withAuth, requireUser, withLibrary)
  .get("/memories", async (c) => {
    const after = c.req.query("after");
    return c.json(await c.var.library.list(after ? { after } : {}));
  })
  .post("/memories", limitBody, json(TextCapture), async (c) => {
    const result = await c.var.library.capture(c.req.valid("json"));
    if ("conflict" in result) {
      return c.json({ ok: false, error: "conflict" } as const, 409);
    }
    return c.json(result.memory, result.created ? 201 : 200);
  })
  .get("/memories/:id", async (c) => {
    const id = c.req.param("id");
    const memory = UUID.test(id) && (await c.var.library.get(id));
    return memory ? c.json(memory) : c.json(notFound, 404);
  })
  .patch("/memories/:id", limitBody, json(MemoryEdit), async (c) => {
    const id = c.req.param("id");
    const memory =
      UUID.test(id) && (await c.var.library.edit(id, c.req.valid("json")));
    return memory ? c.json(memory) : c.json(notFound, 404);
  })
  .delete("/memories/:id", async (c) => {
    const id = c.req.param("id");
    const removed = UUID.test(id) && (await c.var.library.remove(id));
    return removed ? c.body(null, 204) : c.json(notFound, 404);
  })
  .get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").slice(0, MAX_QUERY_CHARS);
    return c.json({ results: await c.var.library.search(q) });
  });
