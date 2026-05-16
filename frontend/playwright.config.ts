import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test config. Targets the live dev stack on http://localhost:8080
 * (the same thing developers see via `docker compose up`). The docker nginx
 * is HTTP only — TLS in prod is terminated by a host-level nginx and is out
 * of scope for these smoke tests.
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
    baseURL: process.env.LG_BASE_URL ?? "http://localhost:8080",
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
