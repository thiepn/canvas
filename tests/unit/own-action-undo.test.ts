import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canUndoOwnAction,
  restoreOwnActionElement,
  sameUndoStamp,
  type OwnUndoEntry,
  type OwnUndoElement,
} from '../../app/canvas/own-action-undo.ts'

type TestElement = OwnUndoElement & { x: number; label?: string }

function element(id: string, version: number, overrides: Partial<TestElement> = {}): TestElement {
  return { id, version, versionNonce: version * 10 + 1, isDeleted: false, updated: version * 100, x: version * 5, ...overrides }
}

test('own action is undoable only while every affected element still has the exact committed stamp', () => {
  const after = element('shape-a', 5)
  const entry: OwnUndoEntry<TestElement> = {
    mutationId: 'm1',
    committedAt: 10,
    changes: [{ id: after.id, before: element('shape-a', 4), after: { version: 5, versionNonce: 51, isDeleted: false } }],
  }
  const current = new Map([[after.id, after]])
  assert.equal(canUndoOwnAction(entry, current), true)
  assert.equal(sameUndoStamp(after, entry.changes[0].after), true)

  current.set(after.id, element('shape-a', 6))
  assert.equal(canUndoOwnAction(entry, current), false)
})

test('a collaborator touching any member of a multi-element action blocks the entire undo', () => {
  const a = element('a', 3)
  const b = element('b', 7)
  const entry: OwnUndoEntry<TestElement> = {
    mutationId: 'm2',
    committedAt: 20,
    changes: [
      { id: 'a', before: element('a', 2), after: { version: 3, versionNonce: 31, isDeleted: false } },
      { id: 'b', before: element('b', 6), after: { version: 7, versionNonce: 71, isDeleted: false } },
    ],
  }
  assert.equal(canUndoOwnAction(entry, new Map([['a', a], ['b', b]])), true)
  assert.equal(canUndoOwnAction(entry, new Map([['a', element('a', 4)], ['b', b]])), false)
})

test('undoing a newly created element produces a newer tombstone', () => {
  const current = element('created', 2, { x: 50 })
  const restored = restoreOwnActionElement(current, null, 777, 999)
  assert.equal(restored.id, current.id)
  assert.equal(restored.version, 3)
  assert.equal(restored.versionNonce, 777)
  assert.equal(restored.isDeleted, true)
  assert.equal(restored.updated, 999)
})

test('undoing an update restores previous content but remains newer than the current shared version', () => {
  const before = element('shape-a', 4, { x: 10, label: 'before' })
  const current = element('shape-a', 5, { x: 90, label: 'after' })
  const restored = restoreOwnActionElement(current, before, 888, 1234)
  assert.equal(restored.x, 10)
  assert.equal(restored.label, 'before')
  assert.equal(restored.id, current.id)
  assert.equal(restored.version, 6)
  assert.equal(restored.versionNonce, 888)
  assert.equal(restored.isDeleted, false)
  assert.equal(restored.updated, 1234)
})
