import { defineConfig, devices } from '@playwright/test';

/** Live smoke tests (D-190) against the real site; read-only. `LIVE_URL` overrides the site. */
export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: true,
  retries: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.LIVE_URL ?? 'https://touchgrass.co.in',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /live\.spec\.ts/ },
  ],
});
