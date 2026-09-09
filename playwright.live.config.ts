import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 30000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/live-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5190/canvas/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'live-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'live-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'live-webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite --mode live-test --host 127.0.0.1 --port 5190 --strictPort',
    url: 'http://127.0.0.1:5190/canvas/',
    reuseExistingServer: false,
    timeout: 120000,
    env: { VITE_CANVAS_TABLE: 'canvas_ci_elements', VITE_BASE_PATH: '/canvas/' },
  },
})
