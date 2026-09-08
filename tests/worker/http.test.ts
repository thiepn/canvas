import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseBackup } from '../../shared/backup.ts'
const API = 'http://127.0.0.1:8788', ORIGIN = 'http://127.0.0.1:5173', TOKEN = 'local-test-only-not-a-production-secret-0123456789'
let child: ChildProcess | undefined, logs = ''
const directory = mkdtempSync(join(tmpdir(), 'canvas-worker-test-'))
async function start() {
  if (!existsSync('node_modules/wrangler/bin/wrangler.js')) throw new Error('Worker integration tests require npm install. They are not replaced by mocks.')
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'wrangler.test.jsonc', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', directory], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
  const collect = (data: Buffer) => { logs = (logs + data.toString()).slice(-12000) }
  child.stdout?.on('data', collect); child.stderr?.on('data', collect)
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Worker exited: ${logs}`)
    try { if ((await fetch(`${API}/health`)).ok) return } catch { /* wait for the local emulator */ }
    await delay(500)
  }
  throw new Error(`Worker did not start: ${logs}`)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const processToStop = child
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { processToStop.kill('SIGKILL'); resolve() }, 5000)
    processToStop.once('exit', () => { clearTimeout(timer); resolve() }); processToStop.kill('SIGTERM')
  })
}
before(start)
after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }) })
const adminHeaders = { Authorization: `Bearer ${TOKEN}` }
test('health and exactly one shared world endpoint', async () => {
  const health = await (await fetch(`${API}/health`)).json() as { app: string; world: string }
  assert.equal(health.app, 'Canvas'); assert.equal(health.world, 'main')
  assert.equal((await fetch(`${API}/api/connect/other`, { headers: { Origin: ORIGIN } })).status, 404)
  assert.equal((await fetch(`${API}/api/connect/main`, { headers: { Origin: ORIGIN } })).status, 426)
})
test('HTTP CORS, missing and malicious origins, allowed preflight', async () => {
  assert.equal((await fetch(`${API}/api/snapshot`)).status, 403)
  assert.equal((await fetch(`${API}/api/snapshot`, { headers: { Origin: 'https://evil.example' } })).status, 403)
  const response = await fetch(`${API}/api/snapshot`, { method: 'OPTIONS', headers: { Origin: ORIGIN } })
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN)
})
test('anonymous HTTP writes and unprotected administration are forbidden', async () => {
  assert.equal((await fetch(`${API}/api/snapshot`, { method: 'POST', headers: { Origin: ORIGIN } })).status, 405)
  assert.equal((await fetch(`${API}/api/admin/snapshots`)).status, 401)
  assert.equal((await fetch(`${API}/api/admin/snapshots`, { headers: { ...adminHeaders, Origin: ORIGIN } })).status, 403)
})
test('malformed and unsupported restore requests do not corrupt durable state', async () => {
  const original = parseBackup(await (await fetch(`${API}/api/snapshot`, { headers: { Origin: ORIGIN } })).text())
  assert.equal((await fetch(`${API}/api/admin/restore`, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json', 'If-Match': '0' }, body: '{invalid' })).status, 400)
  const bad = structuredClone(original)
  bad.snapshot.documents.push({ state: { typeName: 'asset', id: 'asset:bad', props: { src: 'data:image/png,...' } }, lastChangedClock: 0 })
  assert.equal((await fetch(`${API}/api/admin/restore`, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json', 'If-Match': '0' }, body: JSON.stringify(bad) })).status, 400)
  const after = parseBackup(await (await fetch(`${API}/api/snapshot`, { headers: { Origin: ORIGIN } })).text())
  assert.deepEqual(after.snapshot.documents, original.snapshot.documents)
})
test('owner snapshot, guarded restore, and SQLite survive a real worker process restart', async () => {
  const candidate = parseBackup(await (await fetch(`${API}/api/snapshot`, { headers: { Origin: ORIGIN } })).text())
  candidate.snapshot.documents.find(item => item.state.typeName === 'page')!.state.name = 'Persisted across process restart'
  const info = await (await fetch(`${API}/api/admin/snapshots`, { headers: adminHeaders })).json() as { clock: number }
  const response = await fetch(`${API}/api/admin/restore`, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json', 'If-Match': String(info.clock) }, body: JSON.stringify(candidate) })
  assert.equal(response.status, 200, await response.text())
  await stop(); await start()
  const after = parseBackup(await (await fetch(`${API}/api/snapshot`, { headers: { Origin: ORIGIN } })).text())
  assert.equal(after.snapshot.documents.find(item => item.state.typeName === 'page')?.state.name, 'Persisted across process restart')
  const saved = await fetch(`${API}/api/admin/snapshots`, { method: 'POST', headers: adminHeaders })
  assert.equal(saved.status, 201)
})
