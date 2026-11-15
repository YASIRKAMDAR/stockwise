import { defineConfig, devices } from '@playwright/test';

// Browser test over the DEMO seed with the test-mode voice parser (VOICE_PROVIDER=fake).
// Locally: npm run e2e  (starts the API on :3100 with a fresh demo database; see scripts/e2e.sh)
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: process.env.STOCKWISE_URL ?? 'http://localhost:3100', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: '/tmp/stockwise-e2e',
  workers: 1,
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], hasTouch: false }, testMatch: /staff\.spec\.ts/ },
    // The owner card needs attempts to exist, so the staff run goes first.
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /owner\.spec\.ts/, dependencies: ['phone'] },
  ],
});
