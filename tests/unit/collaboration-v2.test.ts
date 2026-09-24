import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COLLABORATION_EFFECT_MAX_BYTES,
  COLLABORATION_REACTIONS,
  COLLABORATION_STATE_MAX_BYTES,
  CollaborationSequenceGate,
  createCollaborationEffectPayload,
  createCollaborationStatePayload,
  cursorSmoothingAlpha,
  followerViewport,
  isStaleCollaborationPayload,
  parseCollaborationEffectPayload,
  parseCollaborationStatePayload,
  viewportCenter,
} from '../../app/canvas/collaboration-v2.ts'

const viewport = { scrollX: -120, scrollY: -80, zoom: 2, width: 1000, height: 700 }

test('collaboration state round-trips through the bounded protocol', () => {
  const payload = createCollaborationStatePayload({
    deviceId: 'device-a',
    sessionId: 'session-a',
    sequence: 4,
    sentAt: 1_700_000_000_000,
    displayName: 'Bright Fox',
    color: '#2563eb',
    cursorVisible: true,
    pointer: { x: 250, y: 150, tool: 'pointer', button: 'up' },
    selectedElementIds: ['shape-a', 'shape-b'],
    viewport,
    activity: 'drawing',
  })
  assert.ok(payload)
  assert.deepEqual(parseCollaborationStatePayload(payload), payload)
  assert.ok(JSON.stringify(payload).length < COLLABORATION_STATE_MAX_BYTES)
})

test('state payload rejects malformed coordinates, selections, colors and oversized data', () => {
  const valid = {
    deviceId: 'device-a',
    sessionId: 'session-a',
    sequence: 1,
    sentAt: Date.now(),
    displayName: 'Guest',
    color: '#2563eb',
    cursorVisible: true,
    pointer: { x: 2, y: 3, tool: 'pointer' as const, button: 'up' as const },
    selectedElementIds: ['shape-a'],
    viewport,
    activity: 'idle' as const,
  }
  assert.equal(createCollaborationStatePayload({ ...valid, color: 'red' }), null)
  assert.equal(createCollaborationStatePayload({ ...valid, pointer: { ...valid.pointer, x: Number.NaN } }), null)
  assert.equal(createCollaborationStatePayload({ ...valid, selectedElementIds: Array.from({ length: 257 }, (_, index) => `shape-${index}`) }), null)
  const oversizedIds = Array.from({ length: 256 }, (_, index) => `shape-${index}-${'x'.repeat(90)}`)
  assert.equal(createCollaborationStatePayload({ ...valid, selectedElementIds: oversizedIds }), null)
  assert.deepEqual(parseCollaborationStatePayload({ ...valid, protocol: 2, ignoredExtraProperty: true }), createCollaborationStatePayload(valid))
})

test('sequence gate rejects duplicates and stale packets while accepting a new tab session', () => {
  const gate = new CollaborationSequenceGate()
  assert.equal(gate.accept('device-a', 'session-a', 1), true)
  assert.equal(gate.accept('device-a', 'session-a', 1), false)
  assert.equal(gate.accept('device-a', 'session-a', 0), false)
  assert.equal(gate.accept('device-a', 'session-a', 3), true)
  assert.equal(gate.accept('device-a', 'session-a', 2), false)
  assert.equal(gate.accept('device-a', 'session-b', 1), true)
  gate.remove('device-a')
  assert.equal(gate.accept('device-a', 'session-a', 1), true)
})

test('stale payload detection tolerates current packets but rejects old and far-future timestamps', () => {
  const now = 1_800_000_000_000
  assert.equal(isStaleCollaborationPayload(now - 100, now), false)
  assert.equal(isStaleCollaborationPayload(now - 15_001, now), true)
  assert.equal(isStaleCollaborationPayload(now + 60_001, now), true)
})

test('viewport following preserves remote center and zoom across different local viewport sizes', () => {
  const center = viewportCenter(viewport)
  assert.deepEqual(center, { x: 370, y: 255 })

  const followed = followerViewport(viewport, { width: 1600, height: 900 })
  assert.equal(followed.zoom, 2)
  const followedCenter = viewportCenter({ ...followed, width: 1600, height: 900 })
  assert.ok(Math.abs(followedCenter.x - center.x) < 1e-9)
  assert.ok(Math.abs(followedCenter.y - center.y) < 1e-9)
})

test('cursor smoothing alpha is bounded and advances more with larger elapsed time', () => {
  assert.equal(cursorSmoothingAlpha(0), 0)
  const short = cursorSmoothingAlpha(16)
  const long = cursorSmoothingAlpha(80)
  assert.ok(short > 0 && short < 1)
  assert.ok(long > short && long < 1)
  assert.equal(cursorSmoothingAlpha(10, 0), 1)
})

test('ping and allowlisted emoji reactions round-trip while unknown reactions are rejected', () => {
  const ping = createCollaborationEffectPayload({
    kind: 'ping',
    deviceId: 'device-a',
    sessionId: 'session-a',
    sequence: 1,
    sentAt: Date.now(),
    displayName: 'Guest',
    color: '#2563eb',
    targetDeviceId: 'device-b',
    point: { x: 20, y: 30 },
    emoji: null,
  })
  assert.ok(ping)
  assert.deepEqual(parseCollaborationEffectPayload(ping), ping)

  for (const emoji of COLLABORATION_REACTIONS) {
    const reaction = createCollaborationEffectPayload({
      kind: 'reaction',
      deviceId: 'device-a',
      sessionId: 'session-a',
      sequence: 2,
      sentAt: Date.now(),
      displayName: 'Guest',
      color: '#2563eb',
      targetDeviceId: null,
      point: { x: 20, y: 30 },
      emoji,
    })
    assert.ok(reaction)
    assert.ok(JSON.stringify(reaction).length < COLLABORATION_EFFECT_MAX_BYTES)
    assert.deepEqual(parseCollaborationEffectPayload(reaction), reaction)
  }

  assert.equal(createCollaborationEffectPayload({
    kind: 'reaction',
    deviceId: 'device-a',
    sessionId: 'session-a',
    sequence: 2,
    sentAt: Date.now(),
    displayName: 'Guest',
    color: '#2563eb',
    targetDeviceId: null,
    point: { x: 20, y: 30 },
    emoji: '🚨' as never,
  }), null)
})
