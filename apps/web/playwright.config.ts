import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests (SPEC §18.2). They run against a running dev stack with seeded data and
 * OTP test mode: `pnpm db:seed && pnpm dev`, then `pnpm test:e2e`.
 * First run only: `pnpm --filter @propcare/web exec playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
