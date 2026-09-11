import assert from 'node:assert/strict'
import test from 'node:test'
import { SceneVersionIndex, indexSceneById } from '../../app/canvas/scene-index.ts'

type Element = { id: string; version: number; versionNonce: number; isDeleted: boolean; allowed?: boolean }
const allowed = (element: Element) => element.allowed !== false

function element(id: string, version = 1, versionNonce = 10, isDeleted = false): Element {
  return { id, version, versionNonce, isDeleted }
}

test('unchanged immutable stamps are skipped after the first observation', () => {
  const index = new SceneVersionIndex<Element>()
  const a = element('a')
  const b = element('b')
  assert.deepEqual(index.observe([a, b], allowed), { changed: [a, b], scanned: 2, skipped: 0, ignored: 0, hasDisallowed: false })
  assert.deepEqual(index.observe([a, b], allowed), { changed: [], scanned: 2, skipped: 2, ignored: 0, hasDisallowed: false })
})

test('new object identity with the same immutable stamp is still skipped', () => {
  const index = new SceneVersionIndex<Element>()
  index.observe([element('a', 3, 22)], allowed)
  const recreated = element('a', 3, 22)
  const result = index.observe([recreated], allowed)
  assert.equal(result.changed.length, 0)
  assert.equal(result.skipped, 1)
})

test('stamp snapshots detect an in-place mutation even when the reference is unchanged', () => {
  const index = new SceneVersionIndex<Element>()
  const mutable = element('a', 1, 5)
  index.observe([mutable], allowed)
  mutable.version = 2
  const result = index.observe([mutable], allowed)
  assert.deepEqual(result.changed, [mutable])
  assert.equal(result.skipped, 0)
})

test('version nonce and tombstone changes are observable changes', () => {
  const index = new SceneVersionIndex<Element>()
  index.observe([element('a', 4, 100, false)], allowed)
  assert.equal(index.observe([element('a', 4, 99, false)], allowed).changed.length, 1)
  assert.equal(index.observe([element('a', 4, 99, true)], allowed).changed.length, 1)
})

test('ignored remote versions do not move the index away from authoritative state', () => {
  const index = new SceneVersionIndex<Element>()
  const authority = element('a', 10, 55, false)
  index.mark([authority])

  const previewEcho = element('a', 11, 99, false)
  const ignored = index.observe([previewEcho], allowed, () => true)
  assert.deepEqual(ignored.changed, [])
  assert.equal(ignored.ignored, 1)

  // If the ignored preview had mutated the index, authority would now appear
  // changed. Remaining skipped proves the authoritative stamp stayed indexed.
  const restored = index.observe([{ ...authority }], allowed)
  assert.equal(restored.changed.length, 0)
  assert.equal(restored.skipped, 1)
})

test('disallowed elements are reported but never indexed', () => {
  const index = new SceneVersionIndex<Element>()
  const blocked = { ...element('blocked'), allowed: false }
  const result = index.observe([blocked], allowed)
  assert.equal(result.hasDisallowed, true)
  assert.equal(result.changed.length, 0)
  assert.equal(index.size, 0)
})

test('replace resets stale IDs while mark updates only supplied IDs', () => {
  const index = new SceneVersionIndex<Element>()
  index.mark([element('a'), element('b')])
  assert.equal(index.size, 2)
  index.mark([element('a', 2)])
  assert.equal(index.size, 2)
  index.replace([element('c')])
  assert.equal(index.size, 1)
  index.delete('c')
  assert.equal(index.size, 0)
})

test('indexSceneById builds direct ID lookup without changing order-sensitive input', () => {
  const a = element('a')
  const b = element('b')
  const map = indexSceneById([a, b])
  assert.equal(map.get('a'), a)
  assert.equal(map.get('b'), b)
  assert.equal(map.size, 2)
})
