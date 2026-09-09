import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

// Build the architecture users actually receive. The smoke is isolated from the shared
// production canvas by targeting canvas_ci_elements, which has the same validation and
// realtime configuration plus DELETE solely for deterministic test cleanup.
const env = {
  ...process.env,
  CANVAS_BUILD_DIR: '.preview-dist',
  VITE_CANVAS_TABLE: 'canvas_ci_elements',
  VITE_BASE_PATH: '/canvas/',
}
const options = { stdio: 'inherit', env, shell: process.platform === 'win32' }
const build = spawnSync(npm, ['run', 'build'], options)
if (build.status !== 0) process.exitCode = build.status ?? 1
else {
  const test = spawnSync(npx, ['playwright', 'test', '--config', 'playwright.production.config.ts'], options)
  process.exitCode = test.status ?? 1
}
