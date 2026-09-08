import test from 'node:test'
import assert from 'node:assert/strict'
import { loadIdentity, cleanName, colorForId, IDENTITY_KEY, saveIdentity } from '../../app/presence/identity.ts'
import { loadTheme } from '../../app/storage/preferences.ts'
import { createPublicConfig, normalizeBasePath } from '../../app/config/public-config.ts'
function memory() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } } }
const id = 'ec4145a1-f218-416e-bdb5-a5f79a5f03c0'
test('anonymous identity persists locally and color is deterministic', () => {
  const storage = memory(), first = loadIdentity(storage, () => id)
  assert.equal(first.deviceId, id); assert.match(first.displayName, /^Guest \d{4}$/)
  assert.deepEqual(loadIdentity(storage, () => { throw new Error('Must reuse ID') }), first)
  assert.equal(first.color, colorForId(id))
})
test('corrupt local identity safely regenerates, without a login flow', () => {
  const storage = memory(); storage.setItem(IDENTITY_KEY, '{broken')
  assert.equal(loadIdentity(storage, () => id).deviceId, id)
})
test('names are bounded and sanitized, not authenticated', () => {
  assert.equal(cleanName('\n Jonathan\u0000 '), 'Jonathan')
  assert.equal(cleanName('a'.repeat(100)).length, 32); assert.equal(cleanName('  '), 'Guest')
})
test('unavailable browser storage does not prevent use', () => {
  const storage = { getItem: () => { throw new Error('disabled') }, setItem: () => { throw new Error('disabled') } }
  const identity = loadIdentity(storage, () => id)
  assert.equal(identity.deviceId, id); assert.equal(saveIdentity(storage, identity), false)
})
test('theme preference defaults to system and rejects malformed values', () => {
  const storage = memory(); assert.equal(loadTheme(storage), 'system')
  storage.setItem('canvas.theme.v1', 'dark'); assert.equal(loadTheme(storage), 'dark')
  storage.setItem('canvas.theme.v1', 'anything'); assert.equal(loadTheme(storage), 'system')
})
test('local config works with no license and creates the single world WS URL', () => {
  assert.equal(createPublicConfig(undefined, undefined, 'http://localhost:5173/canvas/').websocketUrl, 'ws://127.0.0.1:8787/api/connect/main')
})
test('production configuration requires a key and secure backend', () => {
  assert.throws(() => createPublicConfig('https://canvas.example', '', 'https://example.github.io/canvas/'), /license/)
  assert.throws(() => createPublicConfig('http://canvas.example', 'public-test-placeholder', 'https://example.github.io/canvas/'), /HTTPS/)
  assert.equal(createPublicConfig('https://canvas.example/', 'public-test-placeholder', 'https://example.github.io/canvas/').websocketUrl, 'wss://canvas.example/api/connect/main')
})
test('configuration rejects URL credentials, paths and malformed origins', () => {
  for (const url of ['ftp://example.com', 'not a URL', 'https://a:b@example.com', 'https://example.com/api', 'https://example.com?key=x']) assert.throws(() => createPublicConfig(url, 'test', 'https://host.example/'))
})
test('Pages base path supports repository and custom-domain roots', () => {
  assert.equal(normalizeBasePath('/canvas'), '/canvas/'); assert.equal(normalizeBasePath('/'), '/')
  for (const path of ['canvas', '/a/../b', '/a?b', '/a#b', '/a\\b']) assert.throws(() => normalizeBasePath(path))
})
