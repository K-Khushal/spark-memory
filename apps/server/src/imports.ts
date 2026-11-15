import { sendImport } from "./queues";
import type { CronCalls } from "./cron-budget";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ImportAction, ImportBatch, ImportCreate } from "@spark/core";
import { openDatabase, openImports, pendingImports } from "@spark/db";
import type { AppEnv, Bindings, ImportMessage } from "./env";
import { requireUser, withAuth } from "./auth";
import { sameOrigin } from "./origin";
import { json, noStore } from "./memories";
import { rateLimited } from "./rate-limit";
import { enqueue } from "./indexing";

const missing = { ok: false, error: "not_found" } as const;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const imports = new Hono<AppEnv>()
  .use("/imports/*", sameOrigin(), withAuth, requireUser, noStore)
  .use("/imports/*", async (c, next) => {
    const expected = c.req.header("x-spark-user");
    if (expected && expected !== c.var.user.id)
      return c.json({ ok: false, error: "account_changed" } as const, 409);
    return next();
  })
  .use("/imports/*", bodyLimit({ maxSize: 2_000_000 }))
  .get("/imports/latest", async (c) =>
    c.json({
      job: (await openImports(c.var.db, c.var.user.id).latest()) ?? null,
    })
  )
  .post(
    "/imports/create",
    rateLimited("CAPTURE_LIMITER"),
    json(ImportCreate),
    async (c) => {
      const job = await openImports(c.var.db, c.var.user.id).create(
        c.req.valid("json")
      );
      return job
        ? c.json({ job })
        : c.json({ ok: false, error: "conflict" } as const, 409);
    }
  )
  .use("/imports/:id/*", async (c, next) =>
    uuid.test(c.req.param("id") ?? "") ? next() : c.json(missing, 404)
  )
  .get("/imports/:id/images", async (c) =>
    c.json({
      ids: await openImports(c.var.db, c.var.user.id).pendingImages(
        c.req.param("id")
      ),
    })
  )
  .post(
    "/imports/:id/batch",
    rateLimited("CAPTURE_LIMITER"),
    json(ImportBatch),
    async (c) => {
      const ok = await openImports(c.var.db, c.var.user.id).append(
        c.req.param("id"),
        c.req.valid("json")
      );
      return ok ? c.json({ ok: true } as const) : c.json(missing, 404);
    }
  )
  .post(
    "/imports/:id/action",
    rateLimited("CAPTURE_LIMITER"),
    json(ImportAction),
    async (c) => {
      const id = c.req.param("id"),
        userId = c.var.user.id;
      const jobs = openImports(c.var.db, userId);
      const ok = await jobs.action(id, c.req.valid("json").action);
      if (!ok) return c.json(missing, 404);
      const job = await jobs.get(id);
      if (job?.state === "running") await sendImport(c.env, { id, userId });
      return c.json({ job });
    }
  );

/** One cron subrequest; queue recovery pages respect Cloudflare's 100-message batch cap. */
async function recoverImports(
  env: Bindings,
  db: Parameters<typeof pendingImports>[0],
  at: Date,
  after?: string
) {
  const jobs = await pendingImports(db, 101, at, after);
  const messages: { body: ImportMessage }[] = (
    jobs.length > 100 ? jobs.slice(0, 99) : jobs
  ).map((body) => ({ body }));
  if (jobs.length > 100)
    messages.push({
      body: { recovery: { at: at.toISOString(), after: jobs[98]!.id } },
    });
  if (messages.length) await env.IMPORT_QUEUE.sendBatch(messages);
}

export async function requeueImports(
  env: Bindings,
  calls?: CronCalls,
  now = new Date()
) {
  if (calls && !calls.take("imports")) return;
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    await recoverImports(env, db, now);
  } finally {
    await close();
  }
}

export type ImportQueueBatch = {
  messages: readonly { body: ImportMessage; ack(): void; retry(): void }[];
};
/** One bounded Capture per delivery; AI uses the existing background Indexing/budget path. */
export async function consumeImports(
  batch: ImportQueueBatch,
  env: Bindings,
  now = new Date()
) {
  const { db, close } = openDatabase(env.HYPERDRIVE.connectionString);
  try {
    for (const message of batch.messages) {
      try {
        if ("recovery" in message.body) {
          const { at, after } = message.body.recovery;
          await recoverImports(env, db, new Date(at), after);
          message.ack();
          continue;
        }
        const { id, userId } = message.body;
        const jobs = openImports(db, userId);
        const result = await jobs.step(id, now, message.body.lease);
        if (result?.target) await enqueue(env, result.target);
        if (result?.lease)
          await sendImport(
            env,
            { ...message.body, lease: result.lease },
            result.dueAt
              ? (new Date(result.dueAt).getTime() - now.getTime()) / 1000
              : 2
          );
        message.ack();
      } catch {
        message.retry();
      }
    }
  } finally {
    await close();
  }
}
