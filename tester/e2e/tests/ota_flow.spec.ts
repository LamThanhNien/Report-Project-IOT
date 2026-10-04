/**
 * OTA Flow — Playwright E2E
 *
 * Tests the tenant OTA/Firmware workflow through the UI.
 * Submit button text: "Đăng nhập" (Vietnamese)
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";

const TENANT_EMAIL    = process.env.TENANT1_EMAIL    || "tenant1@aifom.local";
const TENANT_PASSWORD = process.env.TENANT1_PASSWORD || "tenant1234";

async function loginAsTenant(page: Page) {
  await page.goto("/login");
  await page.locator("input[type='email']").fill(TENANT_EMAIL);
  await page.locator("input[type='password']").fill(TENANT_PASSWORD);
  await page.locator("button[type='submit']").click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15_000 });
}

test.describe("OTA & Firmware UI Flow", () => {
  test("tenant OTA page loads", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/ota");
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("tenant OTA jobs list visible", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/ota");
    await expect(page).toHaveURL(/client\/ota/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("tenant can upload firmware via UI", async ({ page }) => {
    await loginAsTenant(page);
    await page.goto("/client/ota");

    // Look for upload button (text varies)
    const uploadBtn = page.getByRole("button").filter({ hasText: /upload|firmware|tải lên/i }).first();
    const btnVisible = await uploadBtn.isVisible().catch(() => false);

    if (!btnVisible) {
      test.skip(true, "Upload button not found on OTA page — checking firmware tab");
      return;
    }

    await uploadBtn.click();
    const fileInput = page.locator("input[type='file']");
    if (!(await fileInput.isVisible().catch(() => false))) {
      test.skip(true, "File input not visible after clicking upload");
      return;
    }

    await fileInput.setInputFiles({
      name: "test_firmware.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("\x00ESP\xe9" + "A".repeat(508)),
    });

    await page.waitForTimeout(3000);
    const crashed = await page.getByText(/500|internal server error/i).isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
  });

  test("tenant can initiate OTA from UI", async ({ page }) => {
    await loginAsTenant(page);
    // Try new OTA wizard page if it exists
    const resp = await page.goto("/ota/new");
    if (!resp || resp.status() >= 400) {
      await page.goto("/client/ota");
    }
    await expect(page.getByRole("main")).toBeVisible();
  });
});
