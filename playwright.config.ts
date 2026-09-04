import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve this worktree's port block before Playwright reads `baseURL`.
 *
 * This config file is evaluated before `globalSetup` runs, so it cannot await
 * the allocator directly — it shells out to the same script instead. Without
 * it, a worktree with no `.env` would default to port 5173 and drive the
 * *main* checkout's stack, which is how integration runs used to trample a
 * developer's running app.
 */
function resolveAppPort(): string {
  const result = spawnSync(
    "bun",
    [resolve(ROOT, "scripts/stack.ts"), "ensure", "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status === 0 && result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout) as {
        ports?: { APP_PORT?: number };
      };
      if (parsed.ports?.APP_PORT) return String(parsed.ports.APP_PORT);
    } catch {
      // Fall through to the environment.
    }
  }
  return process.env.APP_PORT ?? "5173";
}

const APP_PORT = resolveAppPort();
process.env.APP_PORT = APP_PORT;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${APP_PORT}`;

export default defineConfig({
  testDir: "./tests/",
  testMatch: "**/*.pw.ts",
  timeout: 10_000,
  retries: process.env.CI ? 2 : 1,

  // globalSetup starts the Docker Compose stack before any test runs.
  // globalTeardown shuts it down afterwards.
  // Set SKIP_STACK=1 to bypass both (use an already-running `bun run up` stack).
  globalSetup: "tests/global-setup.ts",
  globalTeardown: "tests/global-teardown.ts",

  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  // Write all artefacts under the repo-root test-results/ directory so they
  // are easy to find and already gitignored.
  outputDir: "./test-results/playwright",

  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "./test-results/playwright-report",
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
