import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
async function files(dir) { const all = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) all.push(...await files(path)); else all.push(path) } return all }
const output = process.env.CANVAS_BUILD_DIR || 'dist'
const paths = (await files(output)).sort(), chunks = [], hash = createHash('sha256')
for (const path of paths) {
  if (path.endsWith('sw.js')) continue
  const data = await readFile(path)
  hash.update(path).update(data)
  if (/\.(js|css)$/.test(path)) {
    const text = data.toString('utf8')
    if (text.includes('__CANVAS_TEST__') || text.includes('local-test-only-not-a-production-secret')) throw new Error(`Test-only code leaked into ${path}`)
    chunks.push({ path, bytes: data.length, gzipBytes: gzipSync(data).length })
  }
}
const buildId = hash.digest('hex').slice(0, 16)
const sw = (await readFile(join(output, 'sw.js'), 'utf8')).replaceAll('__BUILD_ID__', buildId)
await writeFile(join(output, 'sw.js'), sw)
const html = await readFile(join(output, 'index.html'), 'utf8')
if (html.includes('%BASE_URL%') || html.includes('src="/app/')) throw new Error('Unprocessed Vite entry in production HTML.')
const report = { buildId, fileCount: paths.length, chunks, javascriptGzipBytes: chunks.filter(chunk => chunk.path.endsWith('.js')).reduce((sum, chunk) => sum + chunk.gzipBytes, 0) }
await mkdir('artifacts', { recursive: true }); await writeFile(`artifacts/${output === 'dist' ? 'bundle-audit' : 'preview-bundle-audit'}.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
