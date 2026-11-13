import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: process.env.ARTI_E2E_REUSE === "1",
    timeout: 120000,
    env: {
      ARTI_DATA_ROOT: `/tmp/arti-playwright-${process.pid}`,
      ARTI_AUTOTICK_MS: "0",
    },
  },
});
