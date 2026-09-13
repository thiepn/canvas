import test from 'node:test'
import assert from 'node:assert/strict'
import { isTransientSupabaseTestError, retryTransientSupabaseTestOperation } from '../live/supabase-test-helpers.ts'

test('recognizes transient gateway and transport failures', () => {
  assert.equal(isTransientSupabaseTestError({ message: 'Gateway Timeout' }), true)
  assert.equal(isTransientSupabaseTestError({ message: '502 Bad Gateway' }), true)
  assert.equal(isTransientSupabaseTestError({ details: 'Service Unavailable' }), true)
  assert.equal(isTransientSupabaseTestError(new Error('network error while reading response')), true)
  assert.equal(isTransientSupabaseTestError({ code: '504' }), true)
  assert.equal(isTransientSupabaseTestError({ code: '23505', message: 'unique violation' }), false)
})

test('retries an idempotent fixture operation after a transient failure', async () => {
  let calls = 0
  const result = await retryTransientSupabaseTestOperation(async () => {
    calls += 1
    return calls === 1 ? { error: { message: 'Gateway Timeout' }, data: null } : { error: null, data: ['ok'] }
  }, { baseDelayMs: 0 })
  assert.equal(calls, 2)
  assert.deepEqual(result.data, ['ok'])
})

test('fails immediately for non-transient errors', async () => {
  let calls = 0
  await assert.rejects(retryTransientSupabaseTestOperation(async () => {
    calls += 1
    return { error: new Error('invalid fixture request') }
  }, { baseDelayMs: 0 }), /invalid fixture request/)
  assert.equal(calls, 1)
})

test('fails after the bounded transient retry budget is exhausted', async () => {
  let calls = 0
  await assert.rejects(retryTransientSupabaseTestOperation(async () => {
    calls += 1
    return { error: new Error('504 Gateway Timeout') }
  }, { attempts: 3, baseDelayMs: 0 }), /Gateway Timeout/)
  assert.equal(calls, 3)
})
