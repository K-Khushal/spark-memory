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
};

export type AppEnv = { Bindings: Bindings };
