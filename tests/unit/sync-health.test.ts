import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveSyncHealth, recoveryMessage, saveIssueAfterDurableAttempt, type SyncHealthInput } from '../../app/canvas/sync-health.ts'

const live = (patch: Partial<SyncHealthInput> = {}): SyncHealthInput => ({
  connection: 'Live',
  queuedChanges: 0,
  writeInFlight: false,
  assetTransfers: 0,
  localEditing: false,
  saveIssue: 'none',
  ...patch,
})

test('saved is shown only when live and no local or durable work remains', () => {
  assert.equal(deriveSyncHealth(live()).key, 'saved')
  assert.equal(deriveSyncHealth(live({ localEditing: true })).key, 'editing')
  assert.equal(deriveSyncHealth(live({ queuedChanges: 1 })).key, 'waiting')
  assert.equal(deriveSyncHealth(live({ writeInFlight: true })).key, 'saving')
  const assets = deriveSyncHealth(live({ assetTransfers: 1 }))
  assert.equal(assets.key, 'saving')
  assert.match(assets.label, /image/i)
})

test('save failures outrank ordinary queue state while preserving retry semantics', () => {
  const health = deriveSyncHealth(live({ queuedChanges: 2, saveIssue: 'retrying' }))
  assert.equal(health.key, 'retrying-save')
  assert.equal(health.tone, 'error')
  assert.match(health.detail, /still in this tab/i)
})

test('an accepted but unconfirmed write cannot claim saved', () => {
  const health = deriveSyncHealth(live({ saveIssue: 'unconfirmed' }))
  assert.equal(health.key, 'confirming-save')
  assert.equal(health.tone, 'busy')
  assert.match(health.detail, /before claiming everything is saved/i)
})

test('an active retry reports saving while its request is actually in flight', () => {
  const health = deriveSyncHealth(live({ queuedChanges: 2, saveIssue: 'retrying', writeInFlight: true }))
  assert.equal(health.key, 'saving')
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

test('failed image upload remains an explicit unsaved state until retry succeeds', () => {
  const health = deriveSyncHealth(live({ saveIssue: 'asset-error' }))
  assert.equal(health.key, 'retrying-save')
  assert.equal(health.label, 'Image not saved')
  assert.equal(health.tone, 'error')
  assert.match(health.detail, /only in this tab/i)
})


test('durable element results cannot erase an outstanding image save failure', () => {
  assert.equal(saveIssueAfterDurableAttempt(1, 'none'), 'asset-error')
  assert.equal(saveIssueAfterDurableAttempt(2, 'unconfirmed'), 'asset-error')
  assert.equal(saveIssueAfterDurableAttempt(1, 'retrying'), 'asset-error')
  assert.equal(saveIssueAfterDurableAttempt(0, 'none'), 'none')
  assert.equal(saveIssueAfterDurableAttempt(0, 'retrying'), 'retrying')
})
