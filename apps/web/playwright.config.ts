import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the local stack: the Worker in `wrangler dev` (dev
// outbox for sign-in codes, Turnstile test keys) behind the Vite dev server.
// Needs Postgres with migrations applied (`pnpm db:migrate`).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @spark/server dev",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @spark/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
