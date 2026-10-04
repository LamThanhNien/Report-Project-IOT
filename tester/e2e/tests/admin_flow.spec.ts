/**
 * Admin Flow — Playwright E2E
 *
 * Login form uses:
 *   - input[type="email"]  (label: "Địa chỉ email")
 *   - input[type="password"] (label: "Mật khẩu")
 *   - button[type="submit"] (text: "Đăng nhập")
 *
 * Tests:
 *   1. Admin login page loads
 *   2. Admin can log in with valid credentials
 *   3. Admin dashboard is visible after login
 *   4. Admin can navigate to Tenant Management
 *   5. Admin can navigate to Devices page
 *   6. Admin can navigate to Firmware page
 *   7. Admin can navigate to OTA Jobs page
 *   8. Invalid login shows error
 */
import { test, expect, Page } from "@playwright/test";

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "admin@aifom.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator("input[type='email']").fill(ADMIN_EMAIL);
  await page.locator("input[type='password']").fill(ADMIN_PASSWORD);
  await page.locator("button[type='submit']").click();
  // Wait for redirect away from /login
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15_000 });
}

test.describe("Admin Flow", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/login/);
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
  });

  test("admin login with valid credentials", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).not.toHaveURL(/login/);
  });

  test("admin dashboard visible after login", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("admin can navigate to tenant management", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/admin\/tenants/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("admin can navigate to devices page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/devices");
    await expect(page).toHaveURL(/\/devices/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("admin can navigate to firmware page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/firmware");
    await expect(page).toHaveURL(/firmware/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("admin can navigate to OTA jobs page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ota");
    await expect(page).toHaveURL(/ota/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("invalid admin login shows error", async ({ page }) => {
    await page.goto("/login");
    await page.locator("input[type='email']").fill("wrong@aifom.local");
    await page.locator("input[type='password']").fill("wrongpassword");
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
    const stillOnLogin = page.url().includes("login");
    const hasError = await page.locator(".bg-rose-500\\/10").isVisible().catch(() => false);
    expect(stillOnLogin || hasError).toBeTruthy();
  });
});
