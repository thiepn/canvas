import test from 'node:test'
import assert from 'node:assert/strict'
import { isSafeJson, parseBoundedJson } from '../../shared/json.ts'
import { validateCanvasRecord, validateWorldRecords, isAllowedUrl } from '../../shared/document-policy.ts'
import { parseBackup } from '../../shared/backup.ts'
import { baseRecords, fixtureBackup, shape } from './fixtures.ts'
import { classifyClipboard } from '../../app/canvas/clipboard-policy.ts'

test('only finite, bounded plain JSON crosses the network boundary', () => {
  assert.equal(isSafeJson({ ok: [1, 'two', null] }), true)
  assert.equal(isSafeJson({ bad: Infinity }), false)
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
  assert.equal(isSafeJson(cyclic), false)
  assert.equal(isSafeJson(JSON.parse('{"__proto__":{"admin":true}}')), false)
  assert.throws(() => parseBoundedJson(' '.repeat(100), 50))
})
test('all allowed vector types pass and all media types fail', () => {
  for (const type of ['geo', 'draw', 'highlight', 'text', 'line', 'arrow', 'frame', 'group']) assert.equal(validateCanvasRecord(shape(`shape:${type}`, type)), true)
  for (const type of ['image', 'video', 'embed', 'bookmark', 'note']) assert.equal(validateCanvasRecord(shape(`shape:${type}`, type)), false)
  assert.equal(validateCanvasRecord({ id: 'asset:a', typeName: 'asset', props: { src: 'data:image/png;base64,...' } }), false)
  assert.equal(validateCanvasRecord({ id: 'user:a', typeName: 'user', name: 'Not persisted' }), false)
})
test('one page, no arbitrary metadata, safe coordinate bounds', () => {
  assert.equal(validateCanvasRecord({ ...baseRecords()[1], id: 'page:second' }), false)
  assert.equal(validateCanvasRecord({ ...shape(), meta: { binary: 'hidden attachment' } }), false)
  assert.equal(validateCanvasRecord({ ...shape(), x: 1e20 }), false)
  assert.equal(validateCanvasRecord({ ...shape(), props: { geo: 'star' } }), false)
})
test('unsafe links and oversized rich text are rejected', () => {
  assert.equal(isAllowedUrl('https://example.com/path'), true)
  assert.equal(isAllowedUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedUrl('data:text/html,hi'), false)
  assert.equal(validateCanvasRecord({ ...shape('shape:text', 'text'), props: { richText: { type: 'doc', content: [{ type: 'text', text: 'a'.repeat(20001) }] } } }), false)
  assert.equal(validateCanvasRecord({ ...shape(), props: { href: 'javascript:alert(1)', geo: 'rectangle' } }), false)
})
test('world validation rejects duplicate IDs, cycles and missing parents', () => {
  assert.throws(() => validateWorldRecords([...baseRecords(), shape(), shape()]), /duplicate/)
  assert.throws(() => validateWorldRecords([...baseRecords(), { ...shape(), parentId: 'shape:missing' }]), /parent/)
  assert.throws(() => validateWorldRecords([...baseRecords(), { ...shape('shape:a', 'group'), parentId: 'shape:b' }, { ...shape('shape:b', 'group'), parentId: 'shape:a' }]), /cycle/)
})
test('nested frames remain part of exactly one valid world', () => {
  assert.equal(validateWorldRecords([...baseRecords(), shape('shape:frame', 'frame'), { ...shape(), parentId: 'shape:frame' }]).length, 4)
})
test('backup format round-trips and incompatible engine versions fail closed', () => {
  const backup = fixtureBackup(); assert.deepEqual(parseBackup(JSON.stringify(backup)), backup)
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, engineVersion: '99.0.0' })), /Migrate/)
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, worldId: 'another' })))
})
test('bitmap, file and oversized paste are blocked while text works', () => {
  assert.equal(classifyClipboard({ types: ['text/plain'], fileCount: 0, text: 'Hello' }), 'allow')
  assert.equal(classifyClipboard({ types: ['Files'], fileCount: 1 }), 'files')
  assert.equal(classifyClipboard({ types: ['image/png'], fileCount: 0 }), 'files')
  assert.equal(classifyClipboard({ types: ['text/plain'], fileCount: 0, text: 'a'.repeat(20001) }), 'too-large')
})

test('pre-delete recovery reconstructs deleted, updated and newly created records correctly', async () => {
  const { beforeChangeSnapshot } = await import('../../shared/recovery.ts')
  const oldA = shape('shape:a'), oldB = shape('shape:b')
  const current = fixtureBackup(9, [{ ...oldB, x: 100 }, shape('shape:new')])
  const previous = new Map<string, Record<string, unknown>>([['shape:a', oldA], ['shape:b', oldB]])
  const restored = beforeChangeSnapshot(current.snapshot, ['shape:a', 'shape:b', 'shape:new'], previous)
  assert.equal(restored.documents.find(item => item.state.id === 'shape:b')?.state.x, 0)
  assert.ok(restored.documents.some(item => item.state.id === 'shape:a'))
  assert.equal(restored.documents.some(item => item.state.id === 'shape:new'), false)
  assert.equal(restored.documents.length, 4)
})
