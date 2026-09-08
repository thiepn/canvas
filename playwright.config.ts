import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testIgnore: ['**/performance.spec.ts', '**/production.spec.ts'], fullyParallel: false, workers: 1,
  timeout: 60000, expect: { timeout: 15000 }, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'artifacts/playwright-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5173/canvas/', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
  webServer: [
    { command: 'npx wrangler dev --config wrangler.test.jsonc --ip 127.0.0.1 --port 8787 --persist-to .wrangler/canvas-e2e', url: 'http://127.0.0.1:8787/health', reuseExistingServer: false, timeout: 120000 },
    { command: 'npx vite --mode test --host 127.0.0.1 --port 5173 --strictPort', url: 'http://127.0.0.1:5173/canvas/', reuseExistingServer: false, timeout: 120000, env: { VITE_CANVAS_API_URL: 'http://127.0.0.1:8787', VITE_BASE_PATH: '/canvas/' } },
  ],
})
