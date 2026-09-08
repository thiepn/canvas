import { BACKUP_VERSION, ENGINE_VERSION, WORLD_ID, LIMITS } from './limits.ts'
import { isObject, parseBoundedJson } from './json.ts'
import { validateWorldRecords } from './document-policy.ts'

export interface BackupEnvelope {
  format: 'canvas-backup'
  version: 1
  engine: 'tldraw'
  engineVersion: string
  worldId: 'main'
  createdAt: string
  snapshot: {
    schema: Record<string, unknown>
    documents: Array<{ state: Record<string, unknown>; lastChangedClock: number }>
    clock?: number
    documentClock?: number
    tombstones?: Record<string, number>
    tombstoneHistoryStartsAtClock?: number
  }
}
export function wrapBackup(snapshot: BackupEnvelope['snapshot'], now = new Date()): BackupEnvelope {
  return { format: 'canvas-backup', version: BACKUP_VERSION, engine: 'tldraw', engineVersion: ENGINE_VERSION, worldId: WORLD_ID, createdAt: now.toISOString(), snapshot }
}
export function parseBackup(text: string): BackupEnvelope {
  // A whole-world export may legitimately contain more nodes than a WebSocket message.
  if (new TextEncoder().encode(text).byteLength > LIMITS.backupBytes) throw new Error('Backup is too large.')
  const value: unknown = JSON.parse(text)
  if (!isObject(value) || value.format !== 'canvas-backup' || value.version !== BACKUP_VERSION || value.engine !== 'tldraw' || value.worldId !== WORLD_ID || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.engineVersion !== 'string') throw new Error('Not a supported Canvas backup.')
  if (value.engineVersion !== ENGINE_VERSION) throw new Error(`Backup engine ${value.engineVersion} does not match ${ENGINE_VERSION}. Migrate a copy before restoring.`)
  const snapshot = value.snapshot
  if (!isObject(snapshot) || !isObject(snapshot.schema) || !Array.isArray(snapshot.documents)) throw new Error('Missing snapshot schema or documents.')
  parseBoundedJson(JSON.stringify(snapshot.schema), 262_144)
  const states: unknown[] = []
  for (const item of snapshot.documents) {
    if (!isObject(item) || !Number.isSafeInteger(item.lastChangedClock) || (item.lastChangedClock as number) < 0) throw new Error('Invalid document clock.')
    states.push(item.state)
  }
  validateWorldRecords(states)
  // Restore accepts the records and schema only. Caller deliberately resets old clock/tombstones.
  return value as unknown as BackupEnvelope
}
