// `pnpm --filter @spark/db db:seed`: fills the local database with a demo Library.
// Later tickets add the demo Memories here; for now it only proves the connection.
import { loadRootEnv } from "@spark/config/load-env";
import { checkDatabase } from "../index";

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

const health = await checkDatabase(url);
if (!health.ok) throw new Error(`Database unreachable (${health.reason})`);
console.log("db:seed: connected; no demo Library yet.");
