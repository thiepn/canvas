import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const ignored = new Set(['.git', 'node_modules', 'dist', '.preview-dist', '.wrangler', 'artifacts', 'test-results', 'playwright-report'])
async function walk(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path)); else result.push(path)
  }
  return result
}
let count = 0
for (const file of await walk('.')) {
  if (/\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts')) {
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
    if (source.parseDiagnostics.length) throw new Error(`${file}: ${source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`)
    count++
  } else if (/\.(mjs|js)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`${file}: ${result.stderr}`)
    count++
  }
}
console.log(`Syntax checks passed for ${count} TypeScript/TSX/JavaScript files. This is NOT an SDK typecheck, build, or runtime test.`)
