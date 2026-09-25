import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (!existsSync('package-lock.json')) {
  throw new Error('A committed npm lockfile is required before certifying a release.')
}

const pkg = readJson('package.json')
const lock = readJson('package-lock.json')
const rootLock = lock.packages?.['']

if (!rootLock) throw new Error('package-lock.json is missing its root package record.')
if (lock.version !== pkg.version || rootLock.version !== pkg.version) {
  throw new Error(`Release version mismatch: package.json=${pkg.version}, package-lock.json=${lock.version}, lock root=${rootLock.version}.`)
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error(`Release verification requires a stable semver version, received ${pkg.version}.`)
}
if (rootLock.name !== pkg.name) {
  throw new Error(`Release package name mismatch: package.json=${pkg.name}, package-lock root=${rootLock.name}.`)
}

for (const dependency of ['node_modules/@excalidraw/excalidraw', 'node_modules/@supabase/supabase-js']) {
  if (!lock.packages?.[dependency]) throw new Error(`Lockfile is missing ${dependency.replace('node_modules/', '')}.`)
}

const table = process.env.VITE_CANVAS_TABLE?.trim() || 'canvas_elements'
if (table !== 'canvas_elements') {
  throw new Error('Production release verification must target VITE_CANVAS_TABLE=canvas_elements (or leave it unset for that default).')
}

const urlValue = process.env.VITE_SUPABASE_URL?.trim()
if (urlValue) {
  let url
  try {
    url = new URL(urlValue)
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a complete HTTPS URL.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('VITE_SUPABASE_URL must be an HTTPS origin without credentials, path, query, or fragment.')
  }
}

const keyValue = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
if (keyValue !== undefined && (!keyValue || keyValue.length > 512)) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a non-empty bounded publishable key when overridden.')
}

const basePath = process.env.VITE_BASE_PATH?.trim() || '/canvas/'
if (!basePath.startsWith('/') || /[?#\\]/.test(basePath) || basePath.split('/').includes('..')) {
  throw new Error('VITE_BASE_PATH must be an absolute URL path, for example /canvas/ or /.')
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, VITE_CANVAS_TABLE: 'canvas_elements', VITE_BASE_PATH: basePath }

function run(args) {
  const result = spawnSync(npm, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`Certifying Canvas v${pkg.version}`)
run(['audit', '--audit-level=high'])
run(['run', 'check'])

if (process.env.CANVAS_SKIP_PERFORMANCE !== '1') {
  run(['run', 'test:performance'])
  run(['run', 'performance:report'])
  run(['run', 'performance:budget'])
}
