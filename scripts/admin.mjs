import { readFile, writeFile } from 'node:fs/promises'
const [command, ...args] = process.argv.slice(2)
const api = process.env.CANVAS_API_URL?.replace(/\/$/, ''), token = process.env.CANVAS_ADMIN_TOKEN
if (!api || !token) throw new Error('Set CANVAS_API_URL and CANVAS_ADMIN_TOKEN in this terminal. Never put the admin token in a VITE_ variable.')
const origin = new URL(api)
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Remote administration requires HTTPS.')
async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response.json()
}
switch (command) {
  case 'list': console.log(JSON.stringify(await call('/api/admin/snapshots'), null, 2)); break
  case 'snapshot': console.log(JSON.stringify(await call('/api/admin/snapshots', { method: 'POST' }), null, 2)); break
  case 'export': {
    const metadata = await call('/api/admin/snapshots', { method: 'POST' })
    const backup = await call(`/api/admin/snapshots/${metadata.id}`)
    const file = args[0] || `Canvas-backup-${Date.now()}.json`
    await writeFile(file, JSON.stringify(backup)); console.log(`Saved ${file}.`); break
  }
  case 'get': {
    if (!args[0]) throw new Error('Usage: npm run admin -- get SNAPSHOT_ID [FILE]')
    const backup = await call(`/api/admin/snapshots/${encodeURIComponent(args[0])}`), file = args[1] || `Canvas-${args[0]}.json`
    await writeFile(file, JSON.stringify(backup)); console.log(`Saved ${file}.`); break
  }
  case 'restore': {
    const [file] = args, clockIndex = args.indexOf('--expect-clock'), clock = args[clockIndex + 1]
    if (!file || !args.includes('--yes') || clockIndex < 0 || !/^\d+$/.test(clock || '')) throw new Error('Close ALL Canvas tabs, run admin list, review the backup, then: npm run admin -- restore FILE --expect-clock CLOCK --yes')
    const payload = await readFile(file, 'utf8')
    const envelope = JSON.parse(payload)
    if (envelope.format !== 'canvas-backup' || envelope.worldId !== 'main') throw new Error('Not a Canvas world backup.')
    console.log(JSON.stringify(await call('/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': clock }, body: payload }), null, 2)); break
  }
  default: throw new Error('Commands: list, snapshot, export [FILE], get ID [FILE], restore FILE --expect-clock CLOCK --yes')
}
