import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupStore, type Query, type SqlRow, type SqlValue, type Transaction } from '../../worker/storage/BackupStore.ts'
import { retainBackupIds, type BackupInfo } from '../../worker/storage/retention.ts'
import { fixtureBackup, shape } from './fixtures.ts'

function connect(path = ':memory:') {
  const db = new DatabaseSync(path)
  const query: Query = (sql, ...args) => {
    const statement = db.prepare(sql)
    const values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)
    if (!statement.columns().length) { statement.run(...values); return [] }
    return statement.all(...values).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? value.slice().buffer : value])) as SqlRow)
  }
  const transaction: Transaction = body => { db.exec('BEGIN'); try { const result = body(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error } }
  return { db, query, transaction, store: new BackupStore(query, transaction) }
}
test('real SQLite gzip backup persists after every connection closes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-backup-')), path = join(dir, 'canvas.sqlite')
  try {
    const first = connect(path), backup = fixtureBackup(31)
    const info = await first.store.create(backup, 'manual'); first.db.close()
    const second = connect(path)
    assert.deepEqual(await second.store.get(info.id), backup)
    assert.ok(info.bytes < JSON.stringify(backup).length)
    second.db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('multi-row binary backup chunks reassemble without loss', async () => {
  const { db, query, store } = connect()
  try {
    const shapes = Array.from({ length: 48 }, (_, index) => ({ ...shape(`shape:${index}`, 'text'), props: { richText: { type: 'doc', content: [{ type: 'text', text: randomBytes(10000).toString('hex') }] } } }))
    const backup = fixtureBackup(2, shapes), info = await store.create(backup, 'manual')
    assert.ok(query('SELECT * FROM canvas_backup_chunks').length > 1)
    assert.deepEqual(await store.get(info.id), backup)
  } finally { db.close() }
})
test('corrupted backup fails integrity checks instead of restoring garbage', async () => {
  const { db, query, store } = connect()
  try {
    const info = await store.create(fixtureBackup(), 'manual')
    query('UPDATE canvas_backups SET checksum = ? WHERE id = ?', 'corrupted', info.id)
    await assert.rejects(store.get(info.id), /integrity/)
    assert.equal(await store.get('unknown'), null)
  } finally { db.close() }
})
test('partial backup write rolls back atomically in SQLite', async () => {
  const { db, query, transaction } = connect()
  let fail = false
  const failingQuery: Query = (sql: string, ...args: SqlValue[]) => { if (fail && sql.startsWith('INSERT INTO canvas_backup_chunks')) throw new Error('disk failure'); return query(sql, ...args) }
  const store = new BackupStore(failingQuery, transaction)
  try {
    const previous = await store.create(fixtureBackup(1), 'manual'); fail = true
    await assert.rejects(store.create(fixtureBackup(2), 'manual'), /disk failure/)
    assert.equal(store.list().length, 1)
    assert.deepEqual(await store.get(previous.id), fixtureBackup(1))
  } finally { db.close() }
})
test('automatic snapshots deduplicate clocks and rotate recent history', async () => {
  const { db, store } = connect()
  try {
    const now = Date.parse('2026-09-08T00:00:00Z')
    const first = await store.create(fixtureBackup(1), 'automatic', now)
    const duplicate = await store.create(fixtureBackup(1), 'automatic', now + 1)
    assert.equal(first.id, duplicate.id)
    for (let i = 2; i <= 30; i++) await store.create(fixtureBackup(i), 'automatic', now + i * 1000)
    assert.equal(store.list().filter(row => row.kind === 'daily').length, 1)
    assert.equal(store.list().filter(row => row.kind === 'recent').length, 16)
    assert.equal(store.list()[0]?.clock, 30)
  } finally { db.close() }
})
test('retention caps daily, manual and emergency history and byte budget', () => {
  const data: BackupInfo[] = Array.from({ length: 40 }, (_, i) => ({ id: String(i), createdAt: i, kind: i % 2 ? 'daily' : 'manual', bytes: 100, clock: i, checksum: 'ok' }))
  assert.equal(retainBackupIds(data).size, 11)
  assert.equal(retainBackupIds(data, 250).size, 2)
  assert.ok(retainBackupIds(data, 250).has('39'))
})
