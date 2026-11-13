import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 45 * 1000,
  expect: {
    timeout: 8000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    },
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'totem-vertical',
      use: {
        viewport: { width: 1080, height: 1920 },
        hasTouch: true,
      },
    },
    {
      name: 'totem-landscape',
      use: {
        viewport: { width: 1920, height: 1080 },
        hasTouch: false,
      },
    },
  ],
});
