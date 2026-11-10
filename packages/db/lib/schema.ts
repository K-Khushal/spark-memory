// Drizzle schema. Tables arrive with their tickets (PLAN.md §4). The first
// migration only enables the extensions search needs (ADR-0004).
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_PLAN,
  type IndexState,
  type MemoryKind,
  type Plan,
  type Preservation,
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
    kind: text("kind").$type<MemoryKind>().notNull(),
    title: text("title"),
    /** The text of a text Memory. */
    body: text("body"),
    captureNote: text("capture_note"),
    preservation: text("preservation")
      .$type<Preservation>()
      .default("preserved")
      .notNull(),
    indexState: text("index_state")
      .$type<IndexState>()
      .default("indexing")
      .notNull(),
    capturedAt: instant("captured_at"),
    updatedAt: instant("updated_at").$onUpdate(() => new Date()),
    /** Keyword index (ADR-0004): title, then Capture note, then body. */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english'::regconfig, coalesce(${memory.title}, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(${memory.captureNote}, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(${memory.body}, '')), 'C')`
    ),
  },
  (t) => [
    index("memory_user_captured_idx").on(
      t.userId,
      t.capturedAt.desc(),
      t.id.desc()
    ),
    index("memory_search_tsv_idx").using("gin", t.searchTsv),
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
