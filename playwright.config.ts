import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  outputDir: 'output/playwright/runs',
  workers: 1,
  timeout: 50_000,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: process.env.MYTUBE_TEST_ORIGIN ?? 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
})
