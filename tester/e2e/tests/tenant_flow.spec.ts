/**
 * Tenant Flow — Playwright E2E
 *
 * Tests:
 *   1. Tenant login works
 *   2. Tenant reaches client dashboard
 *   3. Tenant can open devices page
 *   4. Tenant can open OTA page
 *   5. Tenant cannot access admin routes
 */
import { test, expect, Page } from "@playwright/test";

const TENANT_EMAIL    = process.env.TENANT1_EMAIL    || "tenant1@aifom.local";
const TENANT_PASSWORD = process.env.TENANT1_PASSWORD || "tenant1234";

async function loginAsTenant(page: Page) {
  await page.goto("/login");
  await page.locator("input[type='email']").fill(TENANT_EMAIL);
  await page.locator("input[type='password']").fill(TENANT_PASSWORD);
  await page.locator("button[type='submit']").click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15_000 });
}

test.describe("Tenant Flow", () => {
  test("tenant login works", async ({ page }) => {
    await loginAsTenant(page);
    await expect(page).not.toHaveURL(/login/);
  });

  test("tenant reaches client dashboard", async ({ page }) => {
    await loginAsTenant(page);
    await expect(page).toHaveURL(/client/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("tenant can open devices page", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/devices");
    await expect(page).toHaveURL(/client\/devices/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("tenant can open OTA page", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/ota");
    await expect(page).toHaveURL(/client\/ota/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("tenant cannot access admin tenant management", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/admin/tenants");
    await page.waitForTimeout(2000);
    const url = page.url();
    const isRedirected = !url.includes("/admin/tenants") || url.includes("login") || url.includes("client");
    const hasError = await page.getByText(/access denied|forbidden|not authorized|403/i).isVisible().catch(() => false);
    expect(isRedirected || hasError).toBeTruthy();
  });

  test("tenant sees device list page (may be empty)", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/devices");
    await expect(page.getByRole("main")).toBeVisible();
  });
});
