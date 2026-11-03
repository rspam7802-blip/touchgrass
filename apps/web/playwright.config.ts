import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WEB_E2E_PORT ?? 3100);
const apiPort = Number(process.env.API_E2E_PORT ?? 4100);
export const ADMIN_STATE = 'e2e/.auth/admin.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'admin-setup', testMatch: /admin\.setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /admin/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /admin/ },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
      dependencies: ['admin-setup'],
      testMatch: /admin\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // Requires the docker-compose stack (pnpm infra:up) and a built API.
      command: 'pnpm --filter @touchgrass/api build && node e2e/start-api.mjs',
      url: `http://localhost:${apiPort}/v1/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { API_E2E_PORT: String(apiPort) },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${port}`,
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { API_URL: `http://localhost:${apiPort}`, SUPPORT_EMAIL: 'support@touchgrass.test' },
    },
  ],
});
