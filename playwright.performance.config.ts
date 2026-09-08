import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'
export default defineConfig({ ...base, testIgnore: [], testMatch: '**/performance.spec.ts', projects: [{ name: 'chromium', use: { browserName: 'chromium' } }], timeout: 300000, reporter: [['list'], ['json', { outputFile: 'artifacts/performance-run.json' }]] })
