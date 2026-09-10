import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/performance',
  fullyParallel: false,
  workers: 1,
  timeout: 300000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/performance-run.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5192/canvas/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'performance-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --mode performance --host 127.0.0.1 --port 5192 --strictPort',
    url: 'http://127.0.0.1:5192/canvas/',
    reuseExistingServer: false,
    timeout: 120000,
    env: { VITE_CANVAS_TABLE: 'canvas_ci_elements', VITE_BASE_PATH: '/canvas/' },
  },
})
