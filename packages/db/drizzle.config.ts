import { loadRootEnv } from "@spark/config/load-env";
import { defineConfig } from "drizzle-kit";

// Locally DATABASE_URL comes from the root .env (Docker Postgres). For dev and
// prod, CI sets it to the Neon direct (non-pooled) connection string.
loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/schema.ts",
  out: "./migrations",
  dbCredentials: { url },
});
