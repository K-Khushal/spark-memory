import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CategoryRequest } from "@spark/core";
import { openCategories, indexingStore } from "@spark/db";
import { embedderFor, prepareCategoryPrototypes } from "@spark/indexing";
import type { AppEnv } from "./env";
import { providers } from "./indexing";
import { json, signedIn } from "./memories";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const notFound = { ok: false, error: "not_found" } as const;
const limitBody = bodyLimit({
  maxSize: 1024,
  onError: (c) => c.json({ ok: false, error: "too_large" } as const, 413),
});

/**
 * A person's own Categories (ADR-0008). Every answer is the whole list,
 * with the progress of the newest Category's re-categorising while it runs,
 * so the dashboard only ever replaces what it has.
 */
export const categories = new Hono<AppEnv>()
  .use("/categories", ...signedIn)
  .use("/categories/*", ...signedIn)
  .get("/categories", async (c) =>
    c.json(await stateOf(c.var.db, c.var.user.id))
  )
  .post("/categories", limitBody, json(CategoryRequest), async (c) => {
    const own = openCategories(c.var.db, c.var.user.id);
    const made = await own.create(c.req.valid("json").name);
    if ("problem" in made) {
      return c.json(
        { ok: false, error: "invalid_name", problem: made.problem } as const,
        400
      );
    }
    await preparePrototypes(c.env, c.var.db, c.var.user.id);
    return c.json(await stateOf(c.var.db, c.var.user.id), 201);
  })
  .patch("/categories/:id", limitBody, json(CategoryRequest), async (c) => {
    const id = c.req.param("id");
    const renamed =
      UUID.test(id) &&
      (await openCategories(c.var.db, c.var.user.id).rename(
        id,
        c.req.valid("json").name
      ));
    if (!renamed) return c.json(notFound, 404);
    if ("problem" in renamed) {
      return c.json(
        { ok: false, error: "invalid_name", problem: renamed.problem } as const,
        400
      );
    }
    await preparePrototypes(c.env, c.var.db, c.var.user.id);
    return c.json(await stateOf(c.var.db, c.var.user.id));
  })
  /** Takes the Category off its Memories; never deletes a Memory. */
  .delete("/categories/:id", async (c) => {
    const id = c.req.param("id");
    const removed =
      UUID.test(id) &&
      (await openCategories(c.var.db, c.var.user.id).remove(id));
    if (!removed) return c.json(notFound, 404);
    return c.json(await stateOf(c.var.db, c.var.user.id));
  });

async function stateOf(
  db: Parameters<typeof openCategories>[0],
  userId: string
) {
  const { categories, run } = await openCategories(db, userId).list();
  // Refreshes use stored vectors, even if no AI provider is configured now.
  return { categories, ...(run && { run }) };
}

async function preparePrototypes(
  env: AppEnv["Bindings"],
  db: Parameters<typeof openCategories>[0],
  userId: string
) {
  // A new Category needs a prototype vector, not a queue message per Memory.
  // The hourly cron later classifies from stored vectors without AI calls.
  const embedder = embedderFor(providers(env));
  if (embedder) {
    const store = indexingStore(db);
    const state = await openCategories(db, userId).list();
    if (!state.run) return;
    const names = state.categories.map((category) => category.name);
    await prepareCategoryPrototypes({
      embedder,
      own: names,
      allow: async () =>
        (await store.spentTodayMicros()) < (await store.dailyBudgetMicros()),
      loadPrototypes: (space, names) =>
        store.loadCategoryPrototypes(userId, space, names),
      savePrototypes: (space, vectors) =>
        store.saveCategoryPrototypes(userId, space, vectors),
      record: (call) =>
        store.recordCall({ ...call, userId: userId, memoryId: null }),
    }).catch(() => undefined);
  }
}
