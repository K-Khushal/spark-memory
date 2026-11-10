import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Locally DATABASE_URL comes from the root .env (Docker Postgres). For dev and
// prod, CI sets it to the Neon direct (non-pooled) connection string.
const rootEnv = new URL("../../.env", import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv))
  process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/schema.ts",
  out: "./migrations",
  dbCredentials: { url },
});
