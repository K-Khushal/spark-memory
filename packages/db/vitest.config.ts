import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Integration tests read DATABASE_URL from the root .env (CI sets it directly).
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({});
