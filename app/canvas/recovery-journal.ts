import { isPersistableCanvasElement } from './media-assets.ts'
import { isNewerVersion, type VersionStamp } from './sync-version.ts'

export const RECOVERY_SCHEMA_VERSION = 1
export const RECOVERY_MAX_ELEMENTS = 2_000
export const RECOVERY_MAX_BYTES = 8 * 1024 * 1024
export const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const DB_NAME = 'canvas-local-recovery'
const DB_VERSION = 1
const STORE = 'journals'

export type RecoveryElement = {
  id: string
  type: string
  version: number
  versionNonce: number
  isDeleted: boolean
  [key: string]: unknown
}

export type RecoveryJournal = {
  schemaVersion: 1
  key: string
  tableName: string
  deviceId: string
  savedAt: number
  elements: RecoveryElement[]
}

export type RecoveryWriteResult =
  | { ok: true; stored: number; bytes: number }
  | { ok: false; reason: 'unavailable' | 'quota' | 'invalid'; message: string }

function keyFor(tableName: string, deviceId: string): string {
  return `${tableName}:${deviceId}`
}

function elementBytes(element: RecoveryElement): number {
  try { return new TextEncoder().encode(JSON.stringify(element)).length } catch { return Infinity }
}

export function isRecoveryElement(value: unknown): value is RecoveryElement {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && candidate.id.length >= 1
    && candidate.id.length <= 128
    && typeof candidate.type === 'string'
    && Number.isInteger(candidate.version)
    && Number(candidate.version) >= 0
    && Number.isInteger(candidate.versionNonce)
    && typeof candidate.isDeleted === 'boolean'
    && elementBytes(candidate as RecoveryElement) <= 262_144
    && isPersistableCanvasElement(candidate as RecoveryElement)
}

export function buildRecoveryJournal(
  tableName: string,
  deviceId: string,
  elements: readonly RecoveryElement[],
  savedAt = Date.now(),
): RecoveryJournal | null {
  const byId = new Map<string, RecoveryElement>()
  for (const element of elements) {
    if (!isRecoveryElement(element)) continue
    const previous = byId.get(element.id)
    if (!previous || isNewerVersion(element, previous)) byId.set(element.id, element)
  }
  const bounded = [...byId.values()].slice(-RECOVERY_MAX_ELEMENTS)
  const journal: RecoveryJournal = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    key: keyFor(tableName, deviceId),
    tableName,
    deviceId,
    savedAt,
    elements: bounded,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(journal)).length
  return bytes <= RECOVERY_MAX_BYTES ? journal : null
}

export function parseRecoveryJournal(
  value: unknown,
  tableName: string,
  deviceId: string,
  now = Date.now(),
): RecoveryJournal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecoveryJournal>
  if (candidate.schemaVersion !== RECOVERY_SCHEMA_VERSION
    || candidate.key !== keyFor(tableName, deviceId)
    || candidate.tableName !== tableName
    || candidate.deviceId !== deviceId
    || !Number.isFinite(candidate.savedAt)
    || now - Number(candidate.savedAt) > RECOVERY_MAX_AGE_MS
    || !Array.isArray(candidate.elements)
    || candidate.elements.length > RECOVERY_MAX_ELEMENTS
  ) return null
  const elements = candidate.elements.filter(isRecoveryElement)
  if (elements.length !== candidate.elements.length) return null
  const journal = { ...candidate, elements } as RecoveryJournal
  return new TextEncoder().encode(JSON.stringify(journal)).length <= RECOVERY_MAX_BYTES ? journal : null
}

export function recoveryCandidates(
  journal: RecoveryJournal,
  authoritative: ReadonlyMap<string, VersionStamp>,
): RecoveryElement[] {
  const result: RecoveryElement[] = []
  for (const element of journal.elements) {
    const authority = authoritative.get(element.id)
    if (!authority || isNewerVersion(element, authority)) result.push(element)
  }
  return result
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable.'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error ?? new Error('Could not open Canvas recovery storage.'))
    }
    request.onblocked = () => {
      dbPromise = null
      reject(new Error('Canvas recovery storage upgrade was blocked.'))
    }
  })
  return dbPromise
}

export async function readRecoveryJournal(tableName: string, deviceId: string): Promise<RecoveryJournal | null> {
  try {
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readonly')
    const value = await requestResult(transaction.objectStore(STORE).get(keyFor(tableName, deviceId)))
    await transactionDone(transaction)
    return parseRecoveryJournal(value, tableName, deviceId)
  } catch {
    return null
  }
}

export async function writeRecoveryJournal(
  tableName: string,
  deviceId: string,
  elements: readonly RecoveryElement[],
): Promise<RecoveryWriteResult> {
  if (typeof indexedDB === 'undefined') return { ok: false, reason: 'unavailable', message: 'IndexedDB is unavailable.' }
  const journal = buildRecoveryJournal(tableName, deviceId, elements)
  if (!journal) return { ok: false, reason: 'invalid', message: 'Recovery data exceeded Canvas safety limits.' }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(journal)).length
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(journal)
    await transactionDone(transaction)
    return { ok: true, stored: journal.elements.length, bytes }
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    return {
      ok: false,
      reason: name === 'QuotaExceededError' ? 'quota' : 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function clearRecoveryJournal(tableName: string, deviceId: string): Promise<void> {
  try {
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(keyFor(tableName, deviceId))
    await transactionDone(transaction)
  } catch {
    // Crash recovery is best effort and must not affect the live editor.
  }
}
