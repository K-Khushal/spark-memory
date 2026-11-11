import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { AccountDeletion } from "@spark/core";
import {
  EXPORT_TTL_HOURS,
  exportKey,
  openAccount,
  type Account,
  type LibraryExport,
} from "@spark/db";
import type { AppEnv } from "./env";
import { requireUser, withAuth, type UserVariables } from "./auth";
import { deviceName } from "./devices";
import { fileStore } from "./files";
import { json, noStore } from "./memories";

/** The signed-in person's account, for every route below. */
const withAccount = createMiddleware<
  AppEnv & { Variables: UserVariables & { account: Account } }
>(async (c, next) => {
  c.set("account", openAccount(c.var.db, c.var.user.id));
  await next();
});

/**
 * A session as the browser may name it: a short hash of its id, never the
 * id or token themselves (ids are random, so the hash reveals nothing).
 */
async function handleOf(sessionId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`spark-session\n${sessionId}`)
  );
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const notFound = { ok: false, error: "not_found" } as const;

/** Signs this browser out: Better Auth ends the session and clears its cookies. */
async function signOutHere(c: {
  var: UserVariables;
  req: { raw: Request };
  header: (name: string, value: string, options: { append: true }) => void;
}) {
  const out = await c.var.auth.api.signOut({
    headers: c.req.raw.headers,
    asResponse: true,
  });
  for (const cookie of out.headers.getSetCookie()) {
    c.header("Set-Cookie", cookie, { append: true });
  }
}

/** Account settings (sessions, export, deletion), signed in only. */
export const account = new Hono<AppEnv>()
  .use("/account", withAuth, requireUser, withAccount, noStore)
  .use("/account/*", withAuth, requireUser, withAccount, noStore)
  .get("/account/sessions", async (c) => {
    const sessions = await c.var.account.sessions();
    return c.json({
      sessions: await Promise.all(
        sessions.map(async (s) => ({
          handle: await handleOf(s.id),
          device: deviceName(s.userAgent),
          lastActiveAt: s.lastActiveAt,
          current: s.id === c.var.sessionId,
        }))
      ),
    });
  })
  /** Signs one other device out. */
  .delete("/account/sessions/:handle", async (c) => {
    const handle = c.req.param("handle");
    const sessions = await c.var.account.sessions();
    for (const s of sessions) {
      if (s.id !== c.var.sessionId && (await handleOf(s.id)) === handle) {
        await c.var.account.revokeSession(s.id);
        return c.body(null, 204);
      }
    }
    return c.json(notFound, 404);
  })
  /** Signs every device out, this one included. */
  .post("/account/sign-out-everywhere", async (c) => {
    await signOutHere(c);
    await c.var.account.revokeAllSessions();
    return c.body(null, 204);
  })
  .get("/account/export", async (c) =>
    c.json({ export: await shown(c.var.account.export(), c) })
  )
  /** Starts building a ZIP of the whole Library in the background. */
  .post("/account/export", async (c) => {
    const result = await c.var.account.requestExport();
    if ("refused" in result) {
      return c.json({ ok: false, error: result.refused } as const, 409);
    }
    if (result.replaced) await c.env.FILES.delete(result.replaced);
    await c.env.ACCOUNT_QUEUE.send({
      kind: "export",
      exportId: result.started.id,
    }).catch(() => console.error("account: export not sent"));
    return c.json({ export: await shown(result.started, c) }, 202);
  })
  /**
   * Deletes the account and everything in it, permanently, once the person
   * typed their address. Signed out everywhere at once; the account job
   * removes the rest (src/account-jobs.ts).
   */
  .delete("/account", json(AccountDeletion), async (c) => {
    const typed = c.req.valid("json").email.trim().toLowerCase();
    if (typed !== c.var.user.email.toLowerCase()) {
      return c.json({ ok: false, error: "invalid" } as const, 400);
    }
    await signOutHere(c);
    await c.var.account.requestDeletion();
    await c.env.ACCOUNT_QUEUE.send({ kind: "delete", userId: c.var.user.id })
      // The hourly sweep sends it again.
      .catch(() => console.error("account: deletion not sent"));
    return c.body(null, 204);
  });

/** An export as the browser sees it: a signed download link once it is ready. */
async function shown(
  pending: LibraryExport | undefined | Promise<LibraryExport | undefined>,
  c: { env: AppEnv["Bindings"]; req: { url: string }; var: UserVariables }
) {
  const found = await pending;
  if (!found) return null;
  const { id, state, requestedAt, readyAt, bytes } = found;
  if (state !== "ready" || !readyAt) return { state, requestedAt };
  const url = await fileStore(c.env, c.req.url).signDownload(
    exportKey(c.var.user.id, id)
  );
  const expiresAt = new Date(readyAt.getTime() + EXPORT_TTL_HOURS * 3600_000);
  return { state, requestedAt, bytes, url, expiresAt };
}
