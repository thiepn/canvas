import { existsSync, readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
for (const name of ['tldraw', '@tldraw/assets', '@tldraw/sync', '@tldraw/sync-core', '@tldraw/tlschema', 'wrangler']) if (manifest.dependencies?.[name] || manifest.devDependencies?.[name]) throw new Error(`Retired dependency returned: ${name}`)
for (const path of Object.keys(lock.packages ?? {})) if (path === 'node_modules/tldraw' || path.startsWith('node_modules/@tldraw/') || path === 'node_modules/wrangler' || path === 'node_modules/miniflare') throw new Error(`Retired package remains in lockfile: ${path}`)
for (const path of ['worker', 'wrangler.jsonc', 'wrangler.test.jsonc', 'tsconfig.worker.json', 'app/canvas/CanvasEditor.tsx']) if (existsSync(path)) throw new Error(`Retired runtime file returned: ${path}`)
console.log('Production-only architecture audit passed.')
