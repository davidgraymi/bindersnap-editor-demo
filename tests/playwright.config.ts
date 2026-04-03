import { defineConfig, devices } from "@playwright/test";

const APP_PORT = process.env.APP_PORT ?? "5173";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${APP_PORT}`;

export default defineConfig({
  testDir: "./",
  testMatch: "**/*.pw.ts",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 1,

  // globalSetup starts the Docker Compose stack before any test runs.
  // globalTeardown shuts it down afterwards.
  // Set SKIP_STACK=1 to bypass both (use an already-running `bun run up` stack).
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",

  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  // Write all artefacts under the repo-root test-results/ directory so they
  // are easy to find and already gitignored.
  outputDir: "../test-results/playwright",

  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "../test-results/playwright-report",
        open: "never",
      },
    ],
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
