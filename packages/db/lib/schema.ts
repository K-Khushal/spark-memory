// Drizzle schema. Tables arrive with their tickets (PLAN.md §4). The first
// migration only enables the extensions search needs (ADR-0004).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_PLAN,
  type IndexFailure,
  type IndexState,
  type LinkMetadata,
  type MemoryKind,
  type Plan,
  type Preservation,
  type ProviderName,
} from "@spark/core";

// Better Auth tables (ADR-0007), as `npx auth generate` writes them for the
// options in @spark/auth. Regenerate there and update here when those change.
// account.password is Better Auth's fixed shape; email + password sign-in is
// off, so it stays null.

const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  plan: text("plan").$type<Plan>().default(DEFAULT_PLAN).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)]
);

/** Email codes (stored hashed) and OAuth state. */
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

/** Better Auth's per-IP rate limit counters. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const instant = (name: string) =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();

/**
 * One thing a user saved (GLOSSARY.md → Memory), PLAN.md §4. Columns for
 * links, files and Indexing arrive with their tickets. Read and write it only
 * through `openLibrary`, which scopes every query to its owner.
 */
export const memory = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sample: boolean("sample").default(false).notNull(),
    kind: text("kind").$type<MemoryKind>().notNull(),
    title: text("title"),
    /** The text of a text Memory. */
    body: text("body"),
    captureNote: text("capture_note"),
    /**
     * SHA-256 (hex) of the Preserved copy: a file Memory's file, a link's
     * readable text. Unique per person among links.
     */
    contentHash: text("content_hash"),
    /** A link Memory's Source, as the person gave it. */
    sourceUrl: text("source_url"),
    /** `normaliseUrl` of the Source (@spark/core): unique per person, so a page is saved once. */
    sourceUrlNormalised: text("source_url_normalised"),
    /** What gathering a link found (null until it ran): the page's own title, description… */
    metadata: jsonb("metadata").$type<LinkMetadata>(),
    preservation: text("preservation")
      .$type<Preservation>()
      .default("preserved")
      .notNull(),
    indexState: text("index_state")
      .$type<IndexState>()
      .default("indexing")
      .notNull(),
    /** Goes up by one on every edit; an edit based on an older one is refused. */
    revision: integer("revision").default(1).notNull(),
    /**
     * Goes up by one whenever Indexing (re)starts. Indexing writes its result
     * only if the run it loaded is still current, so a late or duplicate
     * queue message can never overwrite newer work.
     */
    indexRun: integer("index_run").default(1).notNull(),
    /**
     * Set by the server when the row is created and never changed. A Memory
     * deleted and created again with the same id (Captures choose their
     * id) gets a new one, so its run restarting at 1 cannot match work
     * loaded from the old row: every Indexing write checks it and the owner.
     * Queue messages only; never sent to clients.
     */
    indexGeneration: uuid("index_generation").defaultRandom().notNull(),
    /**
     * Set while one consumer works on the run, so a duplicate delivery skips
     * instead of paying for the same AI call twice. Expires on its own if
     * that consumer dies.
     */
    indexLeaseUntil: timestamp("index_lease_until", { withTimezone: true }),
    /** The run the lease is for: a new run is never blocked by an old lease. */
    indexLeaseRun: integer("index_lease_run"),
    /**
     * Which queue the current run belongs on (the hourly sweep re-sends it
     * there). Every Capture sets fresh; the default is background, so rows
     * left Indexing from before the queues existed never crowd fresh work.
     */
    indexPriority: text("index_priority")
      .$type<"fresh" | "background">()
      .default("background")
      .notNull(),
    /** The UTC day a Retry or opt-in last went first in line (once a day). */
    indexFreshDay: date("index_fresh_day"),
    /** Why Indexing failed; set only while `indexState` is failed. */
    indexError: text("index_error").$type<IndexFailure>(),
    /** AI opt-out (GLOSSARY.md, ADR-0011): never sent to any AI provider. */
    aiOptOut: boolean("ai_opt_out").default(false).notNull(),
    /** BCP-47 tag Indexing detected; picks the keyword index's language. */
    language: text("language"),
    /**
     * What the Memory's vectors were made from: the embedding space
     * (`model@dimensions`) and the revision of its text. Either differing
     * from now makes them stale, and the hourly sweep makes them again.
     */
    vectorsSpace: text("vectors_space"),
    vectorsRevision: integer("vectors_revision"),
    capturedAt: instant("captured_at"),
    /** Captured again (a duplicate resurfaces the Memory): the wall's order. */
    lastSavedAt: instant("last_saved_at"),
    /**
     * The first time Indexing makes this Memory Searchable. Later runs
     * (an edit, Retry, opt-out off) do not move it, so time to Searchable
     * is measured once.
     */
    firstSearchableAt: timestamp("first_searchable_at", { withTimezone: true }),
    /**
     * The person's choice at Capture. Product events for this Memory are
     * sent only when this is true (Do Not Track was off).
     */
    productAnalytics: boolean("product_analytics").default(false).notNull(),
    updatedAt: instant("updated_at").$onUpdate(() => new Date()),
    /**
     * Keyword index (ADR-0004), weighted and language-aware. Written by a
     * trigger (migrations/0006) from the Memory's own text and, unless it has
     * AI opt-out, its memory_index row: never write it directly.
     */
    searchTsv: tsvector("search_tsv"),
  },
  (t) => [
    index("memory_user_captured_idx").on(
      t.userId,
      t.capturedAt.desc(),
      t.id.desc()
    ),
    index("memory_search_tsv_idx").using("gin", t.searchTsv),
    index("memory_user_saved_idx").on(
      t.userId,
      t.lastSavedAt.desc(),
      t.id.desc()
    ),
    uniqueIndex("memory_user_source_idx")
      .on(t.userId, t.sourceUrlNormalised)
      .where(sql`${t.sourceUrlNormalised} is not null`),
    uniqueIndex("memory_user_link_hash_idx")
      .on(t.userId, t.contentHash)
      .where(sql`${t.kind} = 'link' and ${t.contentHash} is not null`),
  ]
);

export type FileRole = "original" | "thumbnail" | "screenshot" | "page";

/**
 * A file of a Memory in object storage (PLAN.md §4): the original (its
 * Preserved copy), its thumbnail and, for a PDF, an image of each Indexed
 * page (`page` 1, 2…; 0 for every other file). `key` is chosen by the server and starts
 * with the owner's id. `generation` is one upload attempt: Try Again mints
 * another, and the object key includes it, so a confirm cannot accept a
 * later attempt's row. `storedAt` is set once the upload was checked; a
 * Memory with a file not yet stored is left off the wall, and swept if it
 * stays that way (sweepAbandonedUploads).
 */
export const memoryFile = pgTable(
  "memory_file",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    role: text("role").$type<FileRole>().notNull(),
    page: integer("page").default(0).notNull(),
    /** One upload attempt. A new one is minted on create and on Try Again. */
    generation: uuid("generation").notNull().defaultRandom(),
    key: text("r2_key").notNull().unique(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    thumbhash: text("thumbhash"),
    /** An original's dominant colours (hex), most of the image first. */
    palette: text("palette").array(),
    /** A PDF original's page count (its first FREE_ALLOWANCE.pdfPagesIndexed are Indexed). */
    pages: integer("pages"),
    createdAt: instant("created_at"),
    storedAt: timestamp("stored_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.memoryId, t.role, t.page] }),
    index("memory_file_unstored_idx")
      .on(t.createdAt)
      .where(sql`${t.storedAt} is null`),
  ]
);

/**
 * Every distinct word of a Memory's title, Capture note and body, for typo
 * matching (ADR-0004): search corrects each query word against these with
 * pg_trgm, then looks the corrections up in the keyword index. Short words
 * keep the trigram scan cheap however long the Memory. Written by a trigger
 * on memory (migrations/0003), so it can never drift from the text, and
 * deleted with its Memory.
 */
export const memoryWord = pgTable(
  "memory_word",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    word: text("word").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.memoryId, t.word] }),
    index("memory_word_user_idx").on(t.userId),
    index("memory_word_trgm_idx").using("gin", t.word.op("gin_trgm_ops")),
  ]
);

/**
 * What Indexing found for a Memory (PLAN.md §4): one row, replaced on each
 * run, removed when the Memory gets AI opt-out. Feeds search_tsv and
 * memory_word through triggers (migrations/0006).
 */
export const memoryIndex = pgTable("memory_index", {
  memoryId: uuid("memory_id")
    .primaryKey()
    .references(() => memory.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  ocrText: text("ocr_text").notNull(),
  entities: text("entities").array().notNull(),
  tags: text("tags").array().notNull(),
  model: text("model").notNull(),
  indexedAt: instant("indexed_at"),
});

const halfvec = customType<{ data: number[]; driverData: string }>({
  // Any dimension: each row says its own, so a new size is a re-embed, not a migration.
  dataType: () => "halfvec",
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});

export type VectorKind = "overview" | "visual" | "passage";
/**
 * Where a Passage sits: character offsets into the Memory's text or the
 * text in its image, and for a PDF the page they are on.
 */
export type PassageAnchor = {
  field: "body" | "ocr";
  start: number;
  end: number;
  page?: number;
  seconds?: number;
};
/** Where a vector sits: a Passage's text, or the PDF page a Visual is of. */
export type VectorAnchor = PassageAnchor | { page: number };

/**
 * A Memory's vectors (ADR-0004): one Overview, a Visual for an image, and a
 * Passage per stretch of text, each with the model and dimensions that made
 * it. Replaced whole by each embedding; gone with AI opt-out (ADR-0011).
 * Search scans one owner's rows exactly, so `user_id` leads the index.
 */
export const memoryVector = pgTable(
  "memory_vector",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<VectorKind>().notNull(),
    anchor: jsonb("anchor").$type<VectorAnchor>(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: halfvec("embedding").notNull(),
  },
  (t) => [
    index("memory_vector_user_idx").on(t.userId, t.model),
    index("memory_vector_memory_idx").on(t.memoryId),
  ]
);

/**
 * Every AI call Indexing made, with its cost, for the admin page (#32): per
 * Memory and per person. Kept when the Memory is deleted (no foreign key),
 * because the money was spent.
 */
export const aiCall = pgTable(
  "ai_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    /** Null for a search query's embedding. */
    memoryId: uuid("memory_id"),
    /**
     * The Memory's `indexGeneration` when the call was made: with the id,
     * it names the one Memory even after a delete and a new one with that
     * id. Null for a query, and for calls from before it was kept.
     */
    memoryGeneration: uuid("memory_generation"),
    /** The UTC day, as the budget counts it. */
    day: date("day").notNull(),
    provider: text("provider").$type<ProviderName>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    /** True when the cost is a guess: the call timed out, so no usage came back. */
    estimated: boolean("estimated").default(false).notNull(),
    at: instant("at"),
  },
  (t) => [
    index("ai_call_memory_idx").on(t.memoryId),
    index("ai_call_user_day_idx").on(t.userId, t.day),
  ]
);

/** AI spend per UTC day and provider: the global budget breaker reads it. */
export const spendDay = pgTable(
  "spend_day",
  {
    day: date("day").notNull(),
    provider: text("provider").$type<ProviderName>().notNull(),
    costMicros: bigint("cost_micros", { mode: "number" }).default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.provider] })]
);

/**
 * A setting an admin changed (the daily budget). The config default applies
 * when the row is absent. `updatedBy` is a user id, never an email.
 */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: instant("updated_at"),
});

/** One change to a setting: who (user id) and when. Kept if the person is deleted. */
export const settingChange = pgTable("setting_change", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  previousValue: text("previous_value"),
  value: text("value").notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: instant("changed_at"),
});

/**
 * A person who asked for their account to be deleted. While this row exists
 * nobody can sign in as them, and the account job removes their files and
 * rows; deleting the user row at the end removes this one with it.
 */
export const accountDeletion = pgTable("account_deletion", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  requestedAt: instant("requested_at"),
});

export type ExportState = "building" | "ready" | "failed";

/**
 * A person's latest Library export (one at a time): a ZIP in object storage
 * built by the account job, downloadable through a signed URL until it
 * expires. Every build attempt writes its own object
 * (`users/<id>/exports/<export id>/<attempt>.zip`), so removing an
 * abandoned attempt can never touch the one that finished; `key` is that one.
 */
export const libraryExport = pgTable("library_export", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(),
  state: text("state").$type<ExportState>().default("building").notNull(),
  /** Builds started; the job gives up after a few. */
  attempts: integer("attempts").default(0).notNull(),
  /** Set while one job builds it, so a duplicate message skips. */
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  bytes: bigint("bytes", { mode: "number" }),
  /** The finished attempt's ZIP; set once Ready. */
  key: text("r2_key"),
  requestedAt: instant("requested_at"),
  readyAt: timestamp("ready_at", { withTimezone: true }),
});

/**
 * Objects to remove from storage once `dueAt` has passed: a replaced or
 * expired export's ZIP, a deleted Memory's files, or an unfinished screenshot.
 * Written before uploading or in the transaction that lets go of the object,
 * and removed only after storage confirms, so a crash in between
 * never leaves an object nobody points at (the hourly sweep drains it).
 */
export const objectRemoval = pgTable("object_removal", {
  key: text("key").primaryKey(),
  dueAt: instant("due_at"),
});

/** First-run state belongs to the person, across devices. */
export const onboarding = pgTable("onboarding", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  step: text("step")
    .$type<
      "disclosure" | "extension" | "capture" | "indexing" | "search" | "done"
    >()
    .default("disclosure")
    .notNull(),
  paused: boolean("paused").default(false).notNull(),
  samplesSeeded: boolean("samples_seeded").default(false).notNull(),
  firstSuccessfulSearchAt: timestamp("first_successful_search_at", {
    withTimezone: true,
  }),
});
