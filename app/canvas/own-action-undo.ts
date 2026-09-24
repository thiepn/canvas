import type { VersionStamp } from './sync-version.ts'

export type OwnUndoElement = {
  id: string
  version: number
  versionNonce: number
  isDeleted: boolean
  updated?: number
}

export type OwnUndoChange<T extends OwnUndoElement = OwnUndoElement> = {
  id: string
  before: T | null
  after: VersionStamp
}

export type OwnUndoEntry<T extends OwnUndoElement = OwnUndoElement> = {
  mutationId: string
  committedAt: number
  changes: OwnUndoChange<T>[]
}

export function sameUndoStamp(element: OwnUndoElement | undefined, stamp: VersionStamp): boolean {
  return !!element
    && element.version === stamp.version
    && element.versionNonce === stamp.versionNonce
    && element.isDeleted === stamp.isDeleted
}

export function canUndoOwnAction<T extends OwnUndoElement>(entry: OwnUndoEntry<T>, currentById: ReadonlyMap<string, T>): boolean {
  return entry.changes.length > 0 && entry.changes.every(change => sameUndoStamp(currentById.get(change.id), change.after))
}

export function randomUndoVersionNonce(): number {
  try {
    const values = new Uint32Array(1)
    globalThis.crypto.getRandomValues(values)
    return values[0] & 0x7fffffff
  } catch {
    return Math.floor(Math.random() * 0x7fffffff)
  }
}

export function restoreOwnActionElement<T extends OwnUndoElement>(
  current: T,
  before: T | null,
  versionNonce = randomUndoVersionNonce(),
  updated = Date.now(),
): T {
  const base = before ?? current
  return {
    ...base,
    id: current.id,
    version: current.version + 1,
    versionNonce,
    isDeleted: before ? before.isDeleted : true,
    updated,
  } as T
}
