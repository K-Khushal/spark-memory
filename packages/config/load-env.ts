import { existsSync } from "node:fs";

/**
 * Loads the repo's root `.env` into `process.env` when it exists. Variables
 * already set (CI, the shell) win, so CI needs no file. For Node-side config
 * and scripts: vitest and drizzle configs, `db:seed`.
 */
export function loadRootEnv(): void {
  const rootEnv = new URL("../../.env", import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}
