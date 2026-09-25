import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RECOVERY_MAX_AGE_MS,
  RECOVERY_MAX_ELEMENTS,
  buildRecoveryJournal,
  parseRecoveryJournal,
  recoveryCandidates,
  type RecoveryElement,
} from '../../app/canvas/recovery-journal.ts'

const element = (id: string, version: number, nonce: number, patch: Partial<RecoveryElement> = {}): RecoveryElement => ({
  id,
  type: 'rectangle',
  version,
  versionNonce: nonce,
  isDeleted: false,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  angle: 0,
  ...patch,
})

test('recovery journal keeps the newest bounded valid version per element', () => {
  const journal = buildRecoveryJournal('canvas_elements', 'device-a', [
    element('a', 1, 20),
    element('a', 2, 30),
    element('a', 2, 10),
    element('b', 1, 10),
  ], 1000)
  assert.ok(journal)
  assert.equal(journal.elements.length, 2)
  assert.equal(journal.elements.find(item => item.id === 'a')?.version, 2)
  assert.equal(journal.elements.find(item => item.id === 'a')?.versionNonce, 10)
})

test('recovery parser rejects stale, foreign, malformed and unsafe data', () => {
  const journal = buildRecoveryJournal('canvas_elements', 'device-a', [element('a', 1, 1)], 1000)
  assert.ok(journal)
  assert.ok(parseRecoveryJournal(journal, 'canvas_elements', 'device-a', 1000 + RECOVERY_MAX_AGE_MS - 1))
  assert.equal(parseRecoveryJournal(journal, 'canvas_elements', 'device-b', 1001), null)
  assert.equal(parseRecoveryJournal(journal, 'canvas_ci_elements', 'device-a', 1001), null)
  assert.equal(parseRecoveryJournal(journal, 'canvas_elements', 'device-a', 1000 + RECOVERY_MAX_AGE_MS + 1), null)
  assert.equal(parseRecoveryJournal({ ...journal, elements: [{ id: '../bad' }] }, 'canvas_elements', 'device-a', 1001), null)
})

test('recovery replay only returns versions that still outrank Supabase authority', () => {
  const journal = buildRecoveryJournal('canvas_elements', 'device-a', [
    element('newer', 5, 10),
    element('equal', 3, 20),
    element('older', 1, 10),
    element('missing', 2, 10),
  ], 1000)
  assert.ok(journal)
  const authority = new Map([
    ['newer', { version: 4, versionNonce: 1, isDeleted: false }],
    ['equal', { version: 3, versionNonce: 20, isDeleted: false }],
    ['older', { version: 2, versionNonce: 1, isDeleted: false }],
  ])
  assert.deepEqual(recoveryCandidates(journal, authority).map(item => item.id), ['newer', 'missing'])
})

test('pending images are never accepted into the durable crash journal', () => {
  const pendingImage = element('image-a', 1, 1, {
    type: 'image',
    fileId: 'a'.repeat(64),
    status: 'pending',
    scale: [1, 1],
  })
  const journal = buildRecoveryJournal('canvas_elements', 'device-a', [pendingImage])
  assert.ok(journal)
  assert.equal(journal.elements.length, 0)
})


test('recovery journal rejects oversized pending sets instead of silently truncating them', () => {
  const elements = Array.from({ length: RECOVERY_MAX_ELEMENTS + 1 }, (_, index) =>
    element(`item-${index}`, 1, index + 1),
  )
  assert.equal(buildRecoveryJournal('canvas_elements', 'device-a', elements), null)
})
