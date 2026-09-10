import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANVAS_PREVIEW_MAX_BYTES,
  PreviewSequenceGate,
  createCanvasPreviewPayload,
  parseCanvasPreviewPayload,
  sameVersionStamp,
  shouldRenderPreview,
  type CanvasPreviewElement,
} from '../../app/canvas/preview-lane.ts'

function element(version = 2): CanvasPreviewElement {
  return { id: 'shape-a', version, versionNonce: 1000 - version, isDeleted: false, type: 'rectangle', x: 10 }
}

test('valid pointer and text previews round-trip through the bounded protocol', () => {
  for (const source of ['pointer', 'text'] as const) {
    const payload = createCanvasPreviewPayload({
      deviceId: 'device-a', sessionId: 'session-a', sequence: 1, source, elements: [element()], sentAt: 1_700_000_000_000,
    })
    assert.ok(payload)
    assert.deepEqual(parseCanvasPreviewPayload(payload), payload)
  }
})

test('preview protocol rejects malformed, empty, oversized, and discrete payloads', () => {
  const base = { protocol: 1, deviceId: 'device-a', sessionId: 'session-a', sequence: 1, sentAt: Date.now(), source: 'pointer', elements: [element()] }
  assert.equal(parseCanvasPreviewPayload({ ...base, sequence: 0 }), null)
  assert.equal(parseCanvasPreviewPayload({ ...base, elements: [] }), null)
  assert.equal(parseCanvasPreviewPayload({ ...base, source: 'discrete' }), null)
  assert.equal(parseCanvasPreviewPayload({ ...base, elements: [{ ...element(), version: Number.NaN }] }), null)
  assert.equal(parseCanvasPreviewPayload({ ...base, padding: 'x'.repeat(CANVAS_PREVIEW_MAX_BYTES) }), null)
})

test('sequence ordering is monotonic per random tab session and reload-safe', () => {
  const gate = new PreviewSequenceGate()
  assert.equal(gate.accept('device-a', 'session-a', 1), true)
  assert.equal(gate.accept('device-a', 'session-a', 1), false)
  assert.equal(gate.accept('device-a', 'session-a', 2), true)
  assert.equal(gate.accept('spoofed-device', 'session-a', 3), false)
  assert.equal(gate.accept('device-a', 'session-after-reload', 1), true)
  gate.clear()
  assert.equal(gate.accept('device-a', 'session-a', 1), true)
})

test('remote preview is visible only when it advances authority and local work is idle', () => {
  const authority = { version: 2, versionNonce: 8, isDeleted: false }
  const newer = { version: 3, versionNonce: 7, isDeleted: false }
  const equal = { ...authority }
  assert.equal(shouldRenderPreview(newer, authority, false), true)
  assert.equal(shouldRenderPreview(equal, authority, false), false)
  assert.equal(shouldRenderPreview(newer, authority, true), false)
  assert.equal(shouldRenderPreview(authority, undefined, false), true)
  assert.equal(sameVersionStamp(authority, equal), true)
  assert.equal(sameVersionStamp(authority, newer), false)
})
