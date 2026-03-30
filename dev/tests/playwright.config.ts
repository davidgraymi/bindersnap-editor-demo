import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.APP_PORT ?? '5173'}`;

export default defineConfig({
  testDir: './',
  testMatch: '**/*.pw.ts',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Do not start a web server — dev stack must already be running
  webServer: undefined,
});
