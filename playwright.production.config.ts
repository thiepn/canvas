import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/production.spec.ts', workers: 1,
  timeout: 60000, expect: { timeout: 15000 }, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/production-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173/Canvas/', ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx wrangler dev --config wrangler.test.jsonc --ip 127.0.0.1 --port 8787 --persist-to .wrangler/canvas-production-test', url: 'http://127.0.0.1:8787/health', reuseExistingServer: false, timeout: 120000 },
    { command: 'npx vite preview --outDir .preview-dist --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173/Canvas/', reuseExistingServer: false, timeout: 120000 },
  ],
})
