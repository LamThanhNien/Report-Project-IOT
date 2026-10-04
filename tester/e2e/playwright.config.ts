import { defineConfig, devices } from "@playwright/test";
import * as path from "path";

// Load .env from tester root
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.resolve(__dirname, "../reports/playwright-report"), open: "never" }],
  ],
  use: {
    baseURL: process.env.FRONTEND_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
