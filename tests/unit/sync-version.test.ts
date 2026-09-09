import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewerVersion, shouldKeepPending, type VersionStamp } from '../../app/canvas/sync-version.ts'

function stamp(version: number, versionNonce: number, isDeleted = false): VersionStamp {
  return { version, versionNonce, isDeleted }
}

test('version ordering uses version first and lower nonce as Excalidraw tie-breaker', () => {
  assert.equal(isNewerVersion(stamp(2, 1), stamp(1, 999)), true)
  assert.equal(isNewerVersion(stamp(2, 9), stamp(2, 10)), true)
  assert.equal(isNewerVersion(stamp(2, 10), stamp(2, 10)), false)
  assert.equal(isNewerVersion(stamp(2, 11), stamp(2, 10)), false)
  assert.equal(isNewerVersion(stamp(1, -999), stamp(2, 1)), false)
})

test('pending retries survive only while they win against authoritative state', () => {
  assert.equal(shouldKeepPending(stamp(4, 20), stamp(3, -999)), true)
  assert.equal(shouldKeepPending(stamp(4, 19), stamp(4, 20)), true)
  assert.equal(shouldKeepPending(stamp(4, 20), stamp(4, 20)), false)
  assert.equal(shouldKeepPending(stamp(4, 21), stamp(4, 20)), false)
  assert.equal(shouldKeepPending(stamp(3, -999), stamp(4, 1)), false)
})

test('deletion state does not override Excalidraw version ordering', () => {
  assert.equal(shouldKeepPending(stamp(6, 1, true), stamp(6, 2, false)), true)
  assert.equal(shouldKeepPending(stamp(6, 2, false), stamp(6, 1, true)), false)
})
