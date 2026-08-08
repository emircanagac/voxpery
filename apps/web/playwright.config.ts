import { defineConfig, devices } from '@playwright/test'

const mobileSmokeSpec = /.*mobile-web-smoke\.spec\.ts/

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: mobileSmokeSpec,
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      testIgnore: mobileSmokeSpec,
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      testIgnore: mobileSmokeSpec,
      use: { ...devices['Desktop Safari'] },
    },

    {
      name: 'mobile-chromium',
      testMatch: mobileSmokeSpec,
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
