import { spawnSync } from 'node:child_process'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
// Never reuse a developer's production API URL, key, or document storage during tests.
const env = { ...process.env, CANVAS_BUILD_DIR: '.preview-dist', VITE_CANVAS_API_URL: 'http://127.0.0.1:8787', VITE_TLDRAW_LICENSE_KEY: '', VITE_BASE_PATH: '/Canvas/' }
const options = { stdio: 'inherit', env, shell: process.platform === 'win32' }
const build = spawnSync(npm, ['run', 'build'], options)
if (build.status !== 0) process.exitCode = build.status ?? 1
else {
  const test = spawnSync(npx, ['playwright', 'test', '--config', 'playwright.production.config.ts'], options)
  process.exitCode = test.status ?? 1
}
