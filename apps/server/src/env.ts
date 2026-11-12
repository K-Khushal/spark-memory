import type { Priority } from "@spark/indexing";

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
  /** Var. The public https origin; required outside local development. */
  BETTER_AUTH_URL?: string;
  /**
   * Var. The pinned extension origin, `chrome-extension://` plus its 32
   * character id. Anything else is ignored. Unset trusts no extension.
   */
  EXTENSION_ORIGIN?: string;
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

  /** R2 bucket of Memory files (wrangler.jsonc); locally, Miniflare's simulation. */
  FILES: FileBucket;
  /** Var: the same bucket's name, for presigned URLs on R2's S3 endpoint. */
  R2_BUCKET?: string;
  /** Secrets. Without them, only a local Worker can sign uploads (to itself). */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  /** Queues (wrangler.jsonc): fresh Captures and Retry, and background re-indexing. */
  INDEX_QUEUE: IndexQueue;
  REINDEX_QUEUE: IndexQueue;
  /** Queue (wrangler.jsonc): Library exports and account deletion (src/account-jobs.ts). */
  ACCOUNT_QUEUE: AccountQueue;
  /** Workers AI (Gemma 4), first in the Indexing chain. Absent locally. */
  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
    /** Markdown Conversion: a PDF's text (free for PDFs; no model reads it). */
    toMarkdown?(
      files: { name: string; blob: Blob },
      options?: { conversionOptions?: Record<string, unknown> }
    ): Promise<unknown>;
  };
  /** Secret: a key from a Cloud project with active billing (ADR-0005). */
  GEMINI_API_KEY?: string;
  /**
   * Secret. Comma-separated owner addresses. Grants the admin role.
   * Unset means nobody is an admin. Never writable through the API.
   */
  ADMIN_EMAILS?: string;
  /** Secret. PostHog project key. Unset means product events are not sent. */
  POSTHOG_KEY?: string;
  /** Var. Capture host, https only. Defaults to https://us.i.posthog.com. */
  POSTHOG_HOST?: string;
  /** Var: "true" only once that project's billing is confirmed; Gemini stays out otherwise. */
  GEMINI_PAID_TIER?: string;
  /**
   * Var: "jina" lets gathering a pasted link ask Jina Reader for pages that
   * need a browser. A third party sees the link, so it is off unless set
   * (docs/research/link-gathering.md). Never used for AI opt-out.
   */
  LINK_READER?: string;
  /** Secret, optional: a Jina Reader key raises its rate limit. */
  JINA_API_KEY?: string;
  /** Var: "fake" (honoured only when SPARK_ENV is local) Indexes with the fake provider. */
  INDEXING_PROVIDER?: string;
};

/**
 * What a queue message carries: which Memory, at which run, and how urgent.
 * `task: "embed"` makes only its vectors again (always background).
 */
export type IndexMessage = {
  memoryId: string;
  run?: number;
  /** The Memory's `indexGeneration`: a message for an earlier Memory with the id does nothing. */
  generation?: string;
  priority: Priority;
  task?: "embed";
};
export type IndexQueue = {
  send(body: IndexMessage, options?: { delaySeconds?: number }): Promise<void>;
};

/** What an account queue message asks for. */
export type AccountMessage =
  { kind: "export"; exportId: string } | { kind: "delete"; userId: string };
export type AccountQueue = {
  send(
    body: AccountMessage,
    options?: { delaySeconds?: number }
  ): Promise<void>;
};

type HttpMetadata = {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
};

/** The parts of an R2 bucket binding the API uses. */
export type FileBucket = {
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<(StoredObject & { body: ReadableStream }) | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string; cacheControl: string } }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: {
    prefix: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean }>;
  createMultipartUpload(
    key: string,
    options: { httpMetadata: HttpMetadata }
  ): Promise<MultipartUpload>;
};
export type MultipartUpload = {
  uploadPart(
    partNumber: number,
    value: Uint8Array
  ): Promise<{ partNumber: number; etag: string }>;
  complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  abort(): Promise<void>;
};
type StoredObject = { size: number; httpMetadata?: HttpMetadata };

export type AppEnv = { Bindings: Bindings };
