import { LIMITS } from '../../shared/limits.ts'
import { parseBackup, type BackupEnvelope } from '../../shared/backup.ts'
import { retainBackupIds, type BackupInfo, type BackupKind } from './retention.ts'
export type SqlValue = string | number | null | ArrayBuffer
export type SqlRow = Record<string, SqlValue>
export type Query = (sql: string, ...bindings: SqlValue[]) => SqlRow[]
export type Transaction = <T>(body: () => T) => T

async function readBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('Backup exceeds its size limit.') }
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
function toInfo(row: SqlRow): BackupInfo {
  return { id: String(row.id), createdAt: Number(row.created_at), kind: row.kind as BackupKind, clock: Number(row.clock), bytes: Number(row.bytes), checksum: String(row.checksum) }
}
/** SQL and transaction injection lets tests use real SQLite without mocking backup behavior. */
export class BackupStore {
  private readonly query: Query
  private readonly transaction: Transaction
  constructor(query: Query, transaction: Transaction) {
    this.query = query
    this.transaction = transaction
    query('CREATE TABLE IF NOT EXISTS canvas_backups (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, kind TEXT NOT NULL, clock INTEGER NOT NULL, bytes INTEGER NOT NULL, checksum TEXT NOT NULL)')
    query('CREATE TABLE IF NOT EXISTS canvas_backup_chunks (backup_id TEXT NOT NULL, sequence INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (backup_id, sequence))')
  }
  list(): BackupInfo[] { return this.query('SELECT * FROM canvas_backups ORDER BY created_at DESC, id DESC').map(toInfo) }
  lastAutomaticTime(): number { return this.list().find(row => row.kind === 'recent' || row.kind === 'daily')?.createdAt ?? 0 }
  async create(envelope: BackupEnvelope, kind: BackupKind | 'automatic', now = Date.now()): Promise<BackupInfo> {
    const json = JSON.stringify(envelope)
    if (new TextEncoder().encode(json).byteLength > LIMITS.backupBytes) throw new Error('World is too large to snapshot.')
    const latest = this.list()
    let actualKind: BackupKind
    if (kind === 'automatic') {
      const today = new Date(now).toISOString().slice(0, 10)
      actualKind = latest.some(row => row.kind === 'daily' && new Date(row.createdAt).toISOString().startsWith(today)) ? 'recent' : 'daily'
    } else actualKind = kind
    const clock = envelope.snapshot.documentClock ?? envelope.snapshot.clock ?? 0
    const duplicate = latest.find(row => row.clock === clock && (row.kind === actualKind || (kind === 'automatic' && actualKind === 'recent')))
    if (duplicate && kind === 'automatic') return duplicate
    const compressed = await readBytes(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), LIMITS.backupCompressedBytes)
    const info: BackupInfo = { id: crypto.randomUUID(), kind: actualKind, createdAt: now, clock, bytes: compressed.byteLength, checksum: await digest(compressed) }
    this.transaction(() => {
      this.query('INSERT INTO canvas_backups VALUES (?, ?, ?, ?, ?, ?)', info.id, info.createdAt, info.kind, info.clock, info.bytes, info.checksum)
      for (let offset = 0, sequence = 0; offset < compressed.byteLength; offset += LIMITS.backupChunkBytes, sequence++) {
        const data = compressed.slice(offset, offset + LIMITS.backupChunkBytes)
        this.query('INSERT INTO canvas_backup_chunks VALUES (?, ?, ?)', info.id, sequence, data.buffer)
      }
      const all = this.list(), keep = retainBackupIds(all)
      for (const row of all) {
        if (keep.has(row.id)) continue
        this.query('DELETE FROM canvas_backup_chunks WHERE backup_id = ?', row.id)
        this.query('DELETE FROM canvas_backups WHERE id = ?', row.id)
      }
    })
    return info
  }
  async get(id: string): Promise<BackupEnvelope | null> {
    const meta = this.query('SELECT * FROM canvas_backups WHERE id = ?', id)[0]
    if (!meta) return null
    const info = toInfo(meta)
    if (info.bytes > LIMITS.backupCompressedBytes || info.bytes < 0) throw new Error('Invalid backup size.')
    const chunks = this.query('SELECT sequence, data FROM canvas_backup_chunks WHERE backup_id = ? ORDER BY sequence', id)
    const compressed = new Uint8Array(info.bytes)
    let offset = 0
    for (let index = 0; index < chunks.length; index++) {
      const row = chunks[index]!
      if (row.sequence !== index || !(row.data instanceof ArrayBuffer)) throw new Error('Backup chunk is missing or invalid.')
      const bytes = new Uint8Array(row.data)
      if (offset + bytes.byteLength > compressed.byteLength) throw new Error('Backup chunk size is invalid.')
      compressed.set(bytes, offset)
      offset += bytes.byteLength
    }
    if (offset !== info.bytes || await digest(compressed) !== info.checksum) throw new Error('Backup integrity check failed.')
    const plain = await readBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')), LIMITS.backupBytes)
    return parseBackup(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plain))
  }
}
