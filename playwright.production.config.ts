import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/production.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 30000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/production-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/canvas/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'production-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'production-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'production-webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite preview --outDir .preview-dist --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/canvas/',
    reuseExistingServer: false,
    timeout: 120000,
  },
})
