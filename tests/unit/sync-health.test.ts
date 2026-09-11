import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveSyncHealth, recoveryMessage, type SyncHealthInput } from '../../app/canvas/sync-health.ts'

const live = (patch: Partial<SyncHealthInput> = {}): SyncHealthInput => ({
  connection: 'Live',
  queuedChanges: 0,
  writeInFlight: false,
  localEditing: false,
  saveIssue: false,
  ...patch,
})

test('saved is shown only when live and no local or durable work remains', () => {
  assert.equal(deriveSyncHealth(live()).key, 'saved')
  assert.equal(deriveSyncHealth(live({ localEditing: true })).key, 'editing')
  assert.equal(deriveSyncHealth(live({ queuedChanges: 1 })).key, 'waiting')
  assert.equal(deriveSyncHealth(live({ writeInFlight: true })).key, 'saving')
})

test('save failures outrank ordinary queue state while preserving retry semantics', () => {
  const health = deriveSyncHealth(live({ queuedChanges: 2, saveIssue: true }))
  assert.equal(health.key, 'retrying-save')
  assert.equal(health.tone, 'error')
  assert.match(health.detail, /still in this tab/i)
})

test('connection loss outranks save activity and explains queued changes', () => {
  const offline = deriveSyncHealth(live({ connection: 'Offline', queuedChanges: 1, writeInFlight: true }))
  assert.equal(offline.key, 'offline')
  assert.match(offline.detail, /waiting to save/i)

  const reconnecting = deriveSyncHealth(live({ connection: 'Reconnecting', queuedChanges: 1 }))
  assert.equal(reconnecting.key, 'reconnecting')
  assert.match(reconnecting.detail, /kept in this tab/i)
})

test('initial connection and synchronization never claim the canvas is saved', () => {
  assert.equal(deriveSyncHealth(live({ connection: 'Connecting' })).key, 'connecting')
  assert.equal(deriveSyncHealth(live({ connection: 'Synchronizing' })).key, 'synchronizing')
  assert.equal(deriveSyncHealth(live({ connection: 'Error' })).key, 'error')
})

test('recovery banners are limited to connection/recovery states', () => {
  assert.equal(recoveryMessage(deriveSyncHealth(live())), null)
  assert.equal(recoveryMessage(deriveSyncHealth(live({ queuedChanges: 1 }))), null)
  assert.match(recoveryMessage(deriveSyncHealth(live({ connection: 'Offline' }))) ?? '', /editing is paused/i)
})
