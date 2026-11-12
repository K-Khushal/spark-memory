import { createMiddleware } from "hono/factory";
import {
  createAuth,
  enabledSocialProviders,
  resendSender,
  type Auth,
  type AuthConfig,
} from "@spark/auth";
import { isDeletionRequested, openDatabase, type Database } from "@spark/db";
import { isVerifiedAdmin, type Plan } from "@spark/core";
import type { AppEnv, Bindings } from "./env";
import { extensionOrigin } from "./origin";

export type SignedInUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  plan: Plan;
  /** Proved by the sign-in method. Admin requires this to be true. */
  emailVerified: boolean;
};

export function authConfig(env: Bindings): AuthConfig {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL || undefined,
    secureCookies: env.SPARK_ENV !== "local",
    extensionOrigin: extensionOrigin(env.EXTENSION_ORIGIN),
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  };
}

export const socialProvidersFor = (env: Bindings) =>
  enabledSocialProviders(authConfig(env));

/**
 * Local development without Resend: the latest code per address, read by
 * GET /api/dev/sign-in-code (the Playwright smoke test signs in with it).
 */
const devOutbox = new Map<string, string>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Only for a local Worker on a local host, so a Worker deployed with the
 * local vars by mistake still never hands out codes.
 */
export const usesDevOutbox = (env: Bindings, requestUrl: string) =>
  env.SPARK_ENV === "local" &&
  !env.RESEND_API_KEY &&
  LOCAL_HOSTS.has(new URL(requestUrl).hostname);

export const readDevOutbox = (email: string) => devOutbox.get(email);

function signInCodeSender(
  env: Bindings,
  requestUrl: string,
  waitUntil: (p: Promise<void>) => void
) {
  if (usesDevOutbox(env, requestUrl)) {
    return (email: string, code: string) => void devOutbox.set(email, code);
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error(
      "RESEND_API_KEY and EMAIL_FROM must be set (docs/deploy.md)"
    );
  }
  const send = resendSender({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  });
  // Never awaited: the response must not wait on (or reveal timing of) email.
  return (email: string, code: string) =>
    waitUntil(
      send(email, code).catch((error: Error) => console.error(error.message))
    );
}

export type AuthVariables = { auth: Auth; db: Database };

/** Better Auth and the database for this request; the database closes once the response is sent. */
export const withAuth = createMiddleware<AppEnv & { Variables: AuthVariables }>(
  async (c, next) => {
    const { db, close } = openDatabase(c.env.HYPERDRIVE.connectionString);
    const waitUntil = (p: Promise<void>) => c.executionCtx.waitUntil(p);
    c.set("db", db);
    c.set(
      "auth",
      createAuth({
        db,
        config: authConfig(c.env),
        sendSignInCode: signInCodeSender(c.env, c.req.url, waitUntil),
      })
    );
    try {
      await next();
    } finally {
      waitUntil(close());
    }
  }
);

export type UserVariables = AuthVariables & {
  user: SignedInUser;
  /** This request's session (never its token). */
  sessionId: string;
};

/**
 * Rejects anonymous requests with 401, and an account being deleted too
 * (a session made in a race with the request is useless at once);
 * otherwise sets `user`.
 */
export const requireUser = createMiddleware<
  AppEnv & { Variables: UserVariables }
>(async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session || (await isDeletionRequested(c.var.db, session.user.id))) {
    return c.json({ ok: false, error: "unauthorized" } as const, 401);
  }
  const { id, email, name, image, plan } = session.user;
  c.set("user", {
    id,
    email,
    name,
    image,
    plan: plan as Plan,
    emailVerified: session.user.emailVerified === true,
  });
  c.set("sessionId", session.session.id);
  await next();
});

/**
 * Admin routes. 401 when there is no session, 403 unless the address is
 * verified and in ADMIN_EMAILS. The role is that list: nothing in the
 * database grants it, and no route can change it.
 */
export const requireAdmin = createMiddleware<
  AppEnv & { Variables: UserVariables }
>(async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session || (await isDeletionRequested(c.var.db, session.user.id))) {
    return c.json({ ok: false, error: "unauthorized" } as const, 401);
  }
  const user = {
    email: session.user.email,
    emailVerified: session.user.emailVerified === true,
  };
  if (!isVerifiedAdmin(user, c.env.ADMIN_EMAILS)) {
    return c.json({ ok: false, error: "forbidden" } as const, 403);
  }
  const { id, email, name, image, plan } = session.user;
  c.set("user", {
    id,
    email,
    name,
    image,
    plan: plan as Plan,
    emailVerified: user.emailVerified,
  });
  c.set("sessionId", session.session.id);
  await next();
});
