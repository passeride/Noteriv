import { defineConfig, devices } from "@playwright/test";

// Lets context.setOffline (and network events) reach service workers too, so pwa.spec.ts can test offline pages.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

// End-to-end tests of the web app. They expect the web app (E2E_BASE_URL, default
// http://localhost:3457) and its API to be running against a throwaway or dev database,
// and an invite code seeded by global-setup.ts. See e2e/README.md.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3457",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // English is the default interface language; one test opens a Vietnamese browser on purpose.
    locale: "en-US",
    // Pages come from the network in these tests; pwa.spec.ts turns the service worker on for itself.
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
