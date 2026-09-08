export interface Identity { deviceId: string; displayName: string; color: string }
export interface LocalStorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const IDENTITY_KEY = 'canvas.identity.v1'
export const PRESENCE_COLORS = ['#2563eb', '#c2410c', '#7c3aed', '#be185d', '#0e7490', '#047857', '#9a3412', '#4338ca'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function stripControlCharacters(value: string): string {
  return Array.from(value, character => character.charCodeAt(0)).filter(code => code >= 32 && code !== 127).map(code => String.fromCharCode(code)).join('')
}
export function cleanName(name: string): string { return stripControlCharacters(name).trim().slice(0, 32) || 'Guest' }
export function colorForId(id: string): string {
  let hash = 0
  for (const letter of id) hash = (Math.imul(31, hash) + letter.charCodeAt(0)) | 0
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]
}
export function loadIdentity(storage: LocalStorageLike | null, uuid: () => string = () => crypto.randomUUID()): Identity {
  try {
    const raw = storage?.getItem(IDENTITY_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (saved && typeof saved === 'object' && 'deviceId' in saved && typeof saved.deviceId === 'string' && UUID.test(saved.deviceId) && 'displayName' in saved && typeof saved.displayName === 'string') {
      const identity = { deviceId: saved.deviceId, displayName: cleanName(saved.displayName), color: colorForId(saved.deviceId) }
      saveIdentity(storage, identity)
      return identity
    }
  } catch { /* Storage may be disabled; identity still works for this tab. */ }
  const deviceId = uuid()
  const identity = { deviceId, displayName: `Guest ${String(parseInt(deviceId.slice(0, 8), 16) % 10000).padStart(4, '0')}`, color: colorForId(deviceId) }
  saveIdentity(storage, identity)
  return identity
}
export function saveIdentity(storage: LocalStorageLike | null, identity: Identity): boolean {
  try { storage?.setItem(IDENTITY_KEY, JSON.stringify(identity)); return !!storage } catch { return false }
}
export function browserStorage(): LocalStorageLike | null {
  try { return window.localStorage } catch { return null }
}
