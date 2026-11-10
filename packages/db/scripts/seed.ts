// `pnpm --filter @spark/db db:seed`: fills the local database with a demo Library.
// Later tickets add the demo Memories here; for now it only proves the connection.
import { existsSync } from "node:fs";
import { checkDatabase } from "../index";

const rootEnv = new URL("../../../.env", import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv))
  process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

const health = await checkDatabase(url);
if (!health.ok) throw new Error(`Database unreachable (${health.reason})`);
console.log("db:seed: connected; no demo Library yet.");
