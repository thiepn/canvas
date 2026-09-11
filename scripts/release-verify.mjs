import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (!existsSync('package-lock.json')) {
  throw new Error('A committed npm lockfile is required before certifying a release.')
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
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
const result = spawnSync(npm, ['run', 'check'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_CANVAS_TABLE: 'canvas_elements', VITE_BASE_PATH: basePath },
})
process.exitCode = result.status ?? 1
