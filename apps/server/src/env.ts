/**
 * Worker bindings, per Wrangler environment (see wrangler.jsonc and docs/deploy.md).
 * Typed structurally so @spark/api-client can read AppType without Workers globals.
 */
export type Bindings = {
  /** Hyperdrive in front of Neon; locally, a direct Docker Postgres connection. */
  HYPERDRIVE: { connectionString: string };
  /** Secret. Sentry stays off when unset (local dev, CI). */
  SENTRY_DSN?: string;
  /** Var set per Wrangler environment in wrangler.jsonc. */
  SPARK_ENV?: "local" | "dev" | "production";

  /** Secret, at least 32 random characters. Signs session cookies. */
  BETTER_AUTH_SECRET: string;
  /** Var. The public origin; inferred from the request when unset. */
  BETTER_AUTH_URL?: string;
  /** Var (public) and secret. Cloudflare's test keys locally and in CI. */
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  /** Secret. Without it, sign-in codes go to the local dev outbox only. */
  RESEND_API_KEY?: string;
  /** Var, e.g. "Spark <sign-in@sparkmemory.xyz>". */
  EMAIL_FROM?: string;
  /** Secrets. A provider without both stays off and its button is hidden. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

export type AppEnv = { Bindings: Bindings };
