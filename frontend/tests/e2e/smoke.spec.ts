import { expect, test } from "@playwright/test";

const ADMIN = "admin";
const PASSWORD = "admin";

/**
 * Selectors here lean on stable attributes (autocomplete, href) rather than
 * accessible names — the UI defaults to Russian, and matching against
 * translated text would couple the tests to the active language.
 */

test.describe("Looking Glass — smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Force EN before any other request so we can match by English headings
    // where it's the simplest thing to assert. Anything outside this localStorage
    // key is untouched.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lg.lang", "en");
      } catch {}
    });
  });

  test("login flow → lands on dashboard with NavBar", async ({ page }) => {
    await page.goto("/login");
    await page.locator("input[autocomplete='username']").fill(ADMIN);
    await page.locator("input[autocomplete='current-password']").fill(PASSWORD);
    await page.locator("button[type='submit']").click();

    await expect(page).toHaveURL(/\/dashboard/);
    // Flat nav items still visible — agents lives behind the Manage
    // dropdown, so we check `tasks` and `dashboard` instead.
    await expect(page.locator("a[href='/dashboard']")).toBeVisible();
    await expect(page.locator("a[href='/tasks']")).toBeVisible();
  });

  test("nav: dashboard → agents (via Manage dropdown) → tasks", async ({ page }) => {
    await login(page);
    // Agents lives under the "Manage" dropdown now. Open it first.
    await page.getByRole("button", { name: /manage|управление/i }).click();
    await page.locator("a[href='/agents']").click();
    await expect(page).toHaveURL(/\/agents/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Tasks is still a flat nav item.
    await page.locator("a[href='/tasks']").click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("public /status renders without auth", async ({ page }) => {
    await page.goto("/status");
    // Public page has its own header — confirm we got there. No NavBar
    // means no auth-only links visible.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("a[href='/tasks']")).not.toBeVisible();
  });

  test("schedules page accessible after login", async ({ page }) => {
    await login(page);
    await page.goto("/schedules");
    await expect(page).toHaveURL(/\/schedules/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("theme toggle flips data-theme attribute", async ({ page }) => {
    await login(page);
    const initial = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme"),
    );
    // Toggle is the only ☀/☾ button in the navbar.
    await page.locator("button[title='Toggle theme']").click();
    const flipped = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme"),
    );
    expect(flipped).not.toBe(initial);
  });

  test("readonly user cannot export but can view tasks (security regression guard)", async ({
    page,
    request,
  }) => {
    // This isn't UI — it's an API-level safety net for the export-auth fix.
    // Lives here so it runs in the same `npm run test:e2e` invocation.
    const adminLogin = await request.post("/api/auth/login", {
      data: { username: ADMIN, password: PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const { access_token: adminToken } = await adminLogin.json();

    const created = await request.post("/api/users", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { username: "e2e_readonly", password: "e2e_password_123", role: "readonly" },
    });
    // 201 on first run, 409 if a previous failed run left it behind — both ok.
    expect([201, 409]).toContain(created.status());

    const roLogin = await request.post("/api/auth/login", {
      data: { username: "e2e_readonly", password: "e2e_password_123" },
    });
    expect(roLogin.ok()).toBeTruthy();
    const { access_token: roToken } = await roLogin.json();

    const tasks = await request.get("/api/tasks?limit=1", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const taskList = await tasks.json();
    if (taskList.length === 0) {
      test.skip(true, "no tasks present — skipping export auth check");
      return;
    }
    const taskId = taskList[0].id;

    const view = await request.get(`/api/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${roToken}` },
    });
    expect(view.status()).toBe(200);

    const exp = await request.get(`/api/tasks/${taskId}/export.json`, {
      headers: { Authorization: `Bearer ${roToken}` },
    });
    expect(exp.status()).toBe(403);

    // Cleanup — best-effort, don't fail the test on this.
    const users = await request.get("/api/users", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const list = await users.json();
    const ro = list.find((u: { username: string }) => u.username === "e2e_readonly");
    if (ro) {
      await request.delete(`/api/users/${ro.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });
});

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.locator("input[autocomplete='username']").fill(ADMIN);
  await page.locator("input[autocomplete='current-password']").fill(PASSWORD);
  await page.locator("button[type='submit']").click();
  await page.waitForURL(/\/dashboard/);
}
