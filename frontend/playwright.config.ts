import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test config. Targets the live dev stack on https://localhost (the same
 * thing developers see via `docker compose up`). Self-signed cert is accepted
 * with `ignoreHTTPSErrors: true`.
 *
 * Run with:   npm run test:e2e
 * Headed UI:  npm run test:e2e:headed
 *
 * The tests assume:
 *   - server stack running (`docker compose -f deploy/docker-compose.server.yml up`)
 *   - admin/admin seeded
 *   - at least one approved agent (smoke test creates it if needed via API)
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.LG_BASE_URL ?? "https://localhost",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
