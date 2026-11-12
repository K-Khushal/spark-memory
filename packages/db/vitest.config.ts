import { loadRootEnv } from "@spark/config/load-env";
import { defineConfig } from "vitest/config";

// Integration tests read DATABASE_URL from the root .env (CI sets it directly).
loadRootEnv();

export default defineConfig({ test: { testTimeout: 30_000 } });
