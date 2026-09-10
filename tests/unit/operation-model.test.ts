import assert from 'node:assert/strict'
import test from 'node:test'
import { CanvasOperationTracker, type CanvasMutation, type CanvasOperationElement } from '../../app/canvas/operation-model.ts'

type TestElement = CanvasOperationElement & { x?: number; label?: string }

function element(id: string, version: number, overrides: Partial<TestElement> = {}): TestElement {
  return { id, version, versionNonce: 1000 - version, isDeleted: false, ...overrides }
}

function harness() {
  const mutations: CanvasMutation<TestElement>[] = []
  let clock = 100
  let id = 0
  const tracker = new CanvasOperationTracker<TestElement>({
    deviceId: () => 'device-a',
    onCommit: mutation => mutations.push(mutation),
    now: () => clock,
    createMutationId: () => `mutation-${++id}`,
    pointerSettleMs: 0,
    discreteQuietMs: 0,
  })
  return { tracker, mutations, advance: (ms: number) => { clock += ms } }
}

test('many versions from one pointer gesture collapse to one logical mutation', () => {
  const { tracker, mutations, advance } = harness()
  tracker.beginPointer()
  for (let version = 1; version <= 8; version++) {
    advance(25)
    tracker.record(element('rectangle-a', version, { x: version * 10 }), false)
  }
  tracker.endPointer()
  const mutation = tracker.flush()

  assert.equal(mutations.length, 1)
  assert.equal(mutation, mutations[0])
  assert.equal(mutation?.source, 'pointer')
  assert.equal(mutation?.kind, 'create')
  assert.equal(mutation?.changes.length, 1)
  assert.equal(mutation?.durationMs, 200)
  const change = mutation?.changes[0]
  assert.equal(change?.type, 'upsert')
  if (change?.type === 'upsert') {
    assert.equal(change.element.version, 8)
    assert.equal(change.element.x, 80)
    assert.equal(change.existedBefore, false)
  }
})

test('moving twenty selected elements remains one mutation with twenty final changes', () => {
  const { tracker, mutations } = harness()
  tracker.beginPointer()
  for (let frame = 1; frame <= 12; frame++) {
    for (let index = 0; index < 20; index++) tracker.record(element(`shape-${index}`, frame + 4, { x: frame * 3 + index }), true)
  }
  tracker.endPointer()
  tracker.flush()

  assert.equal(mutations.length, 1)
  const mutation = mutations[0]
  assert.equal(mutation.source, 'pointer')
  assert.equal(mutation.kind, 'update')
  assert.equal(mutation.changes.length, 20)
  for (const change of mutation.changes) {
    assert.equal(change.type, 'upsert')
    if (change.type === 'upsert') assert.equal(change.element.version, 16)
  }
})

test('discrete keyboard or style bursts group until the quiet boundary', () => {
  const { tracker, mutations } = harness()
  tracker.record(element('shape-a', 2, { x: 10 }), true)
  tracker.record(element('shape-a', 3, { x: 20 }), true)
  tracker.record(element('shape-b', 5, { label: 'styled' }), true)
  tracker.flush()

  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].source, 'discrete')
  assert.equal(mutations[0].kind, 'update')
  assert.equal(mutations[0].changes.length, 2)
})

test('deletion is represented explicitly with the final tombstone version', () => {
  const { tracker, mutations } = harness()
  tracker.record(element('shape-a', 9, { isDeleted: true }), true)
  tracker.flush()

  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].kind, 'delete')
  const change = mutations[0].changes[0]
  assert.equal(change.type, 'delete')
  if (change.type === 'delete') {
    assert.equal(change.elementId, 'shape-a')
    assert.equal(change.version, 9)
    assert.equal(change.tombstone.isDeleted, true)
    assert.equal(change.existedBefore, true)
  }
})

test('starting a pointer gesture closes any prior discrete operation', () => {
  const { tracker, mutations } = harness()
  tracker.record(element('shape-a', 2), true)
  tracker.beginPointer()
  tracker.record(element('shape-b', 1), false)
  tracker.endPointer()
  tracker.flush()

  assert.equal(mutations.length, 2)
  assert.equal(mutations[0].source, 'discrete')
  assert.equal(mutations[1].source, 'pointer')
  assert.equal(mutations[1].kind, 'create')
})

test('a slow text-edit session remains one logical mutation until editing ends', () => {
  const { tracker, mutations, advance } = harness()
  tracker.beginText()
  tracker.record(element('text-a', 2, { label: 'H' }), true)
  advance(1000)
  tracker.record(element('text-a', 3, { label: 'He' }), true)
  advance(1000)
  tracker.record(element('text-a', 4, { label: 'Hello' }), true)
  tracker.endText()

  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].source, 'text')
  assert.equal(mutations[0].kind, 'update')
  assert.equal(mutations[0].changes.length, 1)
  const change = mutations[0].changes[0]
  assert.equal(change.type, 'upsert')
  if (change.type === 'upsert') assert.equal(change.element.label, 'Hello')
})

test('pointer activity without element changes emits no mutation', () => {
  const { tracker, mutations } = harness()
  tracker.beginPointer()
  tracker.endPointer()
  assert.equal(tracker.flush(), null)
  assert.deepEqual(mutations, [])
})
