import { loadRootEnv } from "@spark/config/load-env";
import { defineConfig } from "vitest/config";

// Integration tests read DATABASE_URL from the root .env (CI sets it directly).
loadRootEnv();

// One file at a time: test/budget.test.ts spends the global daily AI budget
// while it runs, which would pause other files' background Indexing.
export default defineConfig({ test: { fileParallelism: false } });
