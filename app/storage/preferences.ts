import type { LocalStorageLike } from '../presence/identity.ts'
export type ThemePreference = 'system' | 'light' | 'dark'
export function readPreference(storage: LocalStorageLike | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}
export function writePreference(storage: LocalStorageLike | null, key: string, value: string): void {
  try { storage?.setItem(key, value) } catch { /* Optional device preference, not shared persistence. */ }
}
/** Canvas is intentionally light-only. Legacy saved theme values are ignored. */
export function loadTheme(_storage: LocalStorageLike | null): ThemePreference {
  return 'light'
}
