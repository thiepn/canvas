import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
if (!existsSync('package-lock.json')) throw new Error('A real npm lockfile is required. Run npm install on a network-enabled machine, review npm audit, and commit package-lock.json before certifying a release.')
if (!process.env.VITE_CANVAS_API_URL?.startsWith('https://')) throw new Error('Set the production HTTPS VITE_CANVAS_API_URL.')
if (!process.env.VITE_TLDRAW_LICENSE_KEY?.trim()) throw new Error('Set a valid VITE_TLDRAW_LICENSE_KEY. This value is public; never substitute the admin secret.')
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
if (!lock.packages?.['node_modules/tldraw']) throw new Error('Lockfile is incomplete; a root-only placeholder is not a lockfile.')
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(command, ['run', 'check'], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exitCode = result.status ?? 1
