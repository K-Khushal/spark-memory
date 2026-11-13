import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the local stack: the Worker in `wrangler dev` (dev
// outbox for sign-in codes, Turnstile test keys) behind the Vite dev server.
// Needs Postgres with migrations applied (`pnpm db:migrate`). SPARK_WEB_PORT
// and SPARK_API_PORT move both servers, so two checkouts can run at once.
const web = `http://localhost:${process.env.SPARK_WEB_PORT ?? 5173}`;
const api = `http://localhost:${process.env.SPARK_API_PORT ?? 8787}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch:
    process.env.POLISH_SCREENSHOTS === "1"
      ? "polish.screenshots.ts"
      : process.env.ADMIN_SCREENSHOTS === "1"
        ? "admin.screenshots.ts"
        : process.env.CATEGORY_SCREENSHOTS === "1"
          ? "categories.screenshots.ts"
          : "*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: Number(process.env.SPARK_EXPECT_TIMEOUT ?? 5000) },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: web,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @spark/server dev",
      url: `${api}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @spark/web dev",
      url: web,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
