import type { LocalStorageLike } from '../presence/identity.ts'
export type ThemePreference = 'system' | 'light' | 'dark'
export function readPreference(storage: LocalStorageLike | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}
export function writePreference(storage: LocalStorageLike | null, key: string, value: string): void {
  try { storage?.setItem(key, value) } catch { /* Optional device preference, not shared persistence. */ }
}
export function loadTheme(storage: LocalStorageLike | null): ThemePreference {
  const saved = readPreference(storage, 'canvas.theme.v1')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}
