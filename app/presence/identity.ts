export interface Identity { deviceId: string; displayName: string; color: string }
export interface LocalStorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const IDENTITY_KEY = 'canvas.identity.v1'
export const PRESENCE_COLORS = [
  '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#0e7490', '#047857',
  '#9a3412', '#4338ca', '#b45309', '#6d28d9', '#0369a1', '#15803d',
] as const
const FRIENDLY_ADJECTIVES = ['Bright', 'Calm', 'Clever', 'Cosmic', 'Curious', 'Gentle', 'Kind', 'Lucky', 'Quick', 'Quiet', 'Sunny', 'Swift', 'Vivid', 'Warm', 'Wild', 'Wise'] as const
const FRIENDLY_NOUNS = ['Badger', 'Comet', 'Falcon', 'Finch', 'Fox', 'Koala', 'Lynx', 'Otter', 'Panda', 'Raven', 'Robin', 'Seal', 'Sparrow', 'Tiger', 'Turtle', 'Wolf'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function stripControlCharacters(value: string): string {
  return Array.from(value).filter(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 32 && codePoint !== 127
  }).join('')
}
function hashId(id: string): number {
  let hash = 0
  for (const letter of id) hash = (Math.imul(31, hash) + letter.charCodeAt(0)) | 0
  return hash >>> 0
}
export function cleanName(name: string): string { return stripControlCharacters(name).trim().slice(0, 32) || 'Guest' }
export function colorForId(id: string): string {
  return PRESENCE_COLORS[hashId(id) % PRESENCE_COLORS.length]
}
export function defaultDisplayNameForId(id: string): string {
  const hash = hashId(id)
  const adjective = FRIENDLY_ADJECTIVES[hash % FRIENDLY_ADJECTIVES.length]
  const nounIndex = Math.floor(hash / FRIENDLY_ADJECTIVES.length) % FRIENDLY_NOUNS.length
  const suffix = Math.floor(hash / (FRIENDLY_ADJECTIVES.length * FRIENDLY_NOUNS.length)) % 100
  return `${adjective} ${FRIENDLY_NOUNS[nounIndex]} ${String(suffix).padStart(2, '0')}`
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
  const identity = { deviceId, displayName: defaultDisplayNameForId(deviceId), color: colorForId(deviceId) }
  saveIdentity(storage, identity)
  return identity
}
export function saveIdentity(storage: LocalStorageLike | null, identity: Identity): boolean {
  try { storage?.setItem(IDENTITY_KEY, JSON.stringify(identity)); return !!storage } catch { return false }
}
export function browserStorage(): LocalStorageLike | null {
  try { return window.localStorage } catch { return null }
}
