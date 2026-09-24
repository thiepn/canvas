import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTheme, readPreference, writePreference } from '../../app/storage/preferences.ts'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('theme defaults to system and restores valid saved values', () => {
  const storage = new MemoryStorage()
  assert.equal(loadTheme(storage), 'system')
  storage.setItem('canvas.theme.v1', 'dark')
  assert.equal(loadTheme(storage), 'dark')
  storage.setItem('canvas.theme.v1', 'light')
  assert.equal(loadTheme(storage), 'light')
  storage.setItem('canvas.theme.v1', 'invalid')
  assert.equal(loadTheme(storage), 'system')
})

test('preferences fail soft when browser storage is unavailable', () => {
  assert.equal(readPreference(null, 'x'), null)
  assert.doesNotThrow(() => writePreference(null, 'x', 'y'))
})
