import { createMiddleware } from "hono/factory";
import {
  createAuth,
  enabledSocialProviders,
  resendSender,
  type Auth,
  type AuthConfig,
} from "@spark/auth";
import { openDatabase } from "@spark/db";
import type { AppEnv, Bindings } from "./env";

export type SignedInUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  plan: string;
};

export function authConfig(env: Bindings): AuthConfig {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL || undefined,
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

export const usesDevOutbox = (env: Bindings) =>
  env.SPARK_ENV === "local" && !env.RESEND_API_KEY;

export const readDevOutbox = (email: string) => devOutbox.get(email);

function signInCodeSender(
  env: Bindings,
  waitUntil: (p: Promise<void>) => void
) {
  if (usesDevOutbox(env)) {
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

type AuthVariables = { auth: Auth };

/** Better Auth for this request; its database closes once the response is sent. */
export const withAuth = createMiddleware<AppEnv & { Variables: AuthVariables }>(
  async (c, next) => {
    const { db, close } = openDatabase(c.env.HYPERDRIVE.connectionString);
    const waitUntil = (p: Promise<void>) => c.executionCtx.waitUntil(p);
    c.set(
      "auth",
      createAuth({
        db,
        config: authConfig(c.env),
        sendSignInCode: signInCodeSender(c.env, waitUntil),
      })
    );
    try {
      await next();
    } finally {
      waitUntil(close());
    }
  }
);

/** Rejects anonymous requests with 401; otherwise sets `user`. */
export const requireUser = createMiddleware<
  AppEnv & { Variables: AuthVariables & { user: SignedInUser } }
>(async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ ok: false, error: "unauthorized" } as const, 401);
  }
  const { id, email, name, image, plan } = session.user;
  c.set("user", { id, email, name, image, plan });
  await next();
});
