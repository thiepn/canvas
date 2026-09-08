import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFrame, EMPTY_FRAME_STATE } from '../../worker/security/frame-guard.ts'
import { consumeRate, newRateState } from '../../worker/security/rate-limit.ts'
import { parseOrigins, originAllowed, corsHeaders } from '../../worker/security/origins.ts'
import { authorizedAdmin, readLimitedBody } from '../../worker/security/admin.ts'
import { LIMITS } from '../../shared/limits.ts'

test('proper origin matching is exact, not a suffix check', () => {
  const origins = parseOrigins('https://person.github.io, http://localhost:5173')
  assert.equal(originAllowed(new Request('https://api.example', { headers: { Origin: 'https://person.github.io' } }), origins), true)
  assert.equal(originAllowed(new Request('https://api.example', { headers: { Origin: 'https://person.github.io.evil.test' } }), origins), false)
  assert.equal(originAllowed(new Request('https://api.example'), origins), false)
  assert.throws(() => parseOrigins('https://example.com/path'))
})
test('CORS does not expose credentials or wildcard access', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://site.example' } })
  const headers = corsHeaders(request, parseOrigins('https://site.example'))
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://site.example')
  assert.equal(headers.has('Access-Control-Allow-Credentials'), false)
})
test('protocol frame guard accepts complete and ordered chunked messages', () => {
  assert.deepEqual(checkFrame(EMPTY_FRAME_STATE, '{"type":"ping"}', 0), EMPTY_FRAME_STATE)
  const first = checkFrame(EMPTY_FRAME_STATE, '1_{"type":', 0)
  assert.equal(first.remaining, 1)
  assert.deepEqual(checkFrame(first, '0_"ping"}', 20), EMPTY_FRAME_STATE)
})
test('frame guard rejects binary, malformed, out of order and stale chunks', () => {
  assert.throws(() => checkFrame(EMPTY_FRAME_STATE, new ArrayBuffer(10), 0), /Binary/)
  assert.throws(() => checkFrame(EMPTY_FRAME_STATE, 'bad', 0))
  assert.throws(() => checkFrame(EMPTY_FRAME_STATE, '999_a', 0))
  const first = checkFrame(EMPTY_FRAME_STATE, '2_a', 0)
  assert.throws(() => checkFrame(first, '0_b', 1), /sequence/)
  assert.throws(() => checkFrame(first, '{}', 1), /Unexpected/)
  assert.throws(() => checkFrame(first, '1_b', 16000), /expired/)
})
test('size limits count UTF-8 bytes and bound multi-frame accumulation', () => {
  assert.throws(() => checkFrame(EMPTY_FRAME_STATE, '{' + '💾'.repeat(300000), 0), /large/)
  const first = checkFrame(EMPTY_FRAME_STATE, '2_' + 'a'.repeat(1000000), 0)
  const second = checkFrame(first, '1_' + 'a'.repeat(1000000), 1)
  assert.throws(() => checkFrame(second, '0_' + 'a'.repeat(200000), 2), /Assembled/)
})
test('token bucket allows ordinary activity, blocks floods, and refills after idle', () => {
  let state = newRateState(0)
  for (let i = 0; i < LIMITS.messageBurst; i++) { const next = consumeRate(state, 10, 0); assert.ok(next); state = next }
  assert.equal(consumeRate(state, 10, 0), null)
  assert.ok(consumeRate(state, 10, 1000))
  assert.equal(consumeRate(newRateState(0), LIMITS.byteBurst + 1, 0), null)
})
test('admin tokens fail closed when missing, too short or incorrect', async () => {
  const secret = 'x'.repeat(40), request = (value: string) => new Request('https://api.example', { headers: { Authorization: `Bearer ${value}` } })
  assert.equal(await authorizedAdmin(request(secret), secret), true)
  assert.equal(await authorizedAdmin(request('wrong'), secret), false)
  assert.equal(await authorizedAdmin(request(secret), undefined), false)
  assert.equal(await authorizedAdmin(request('small'), 'small'), false)
})
test('request reader enforces byte limits without trusting Content-Length', async () => {
  const request = () => new Request('https://api.example', { method: 'POST', body: 'ééé' })
  await assert.rejects(readLimitedBody(request(), 5), /large/)
  assert.equal(await readLimitedBody(request(), 6), 'ééé')
})

test('world byte budget accounts for updates/deletes and rejects growth before commit', async () => {
  const { WorldBudget } = await import('../../worker/security/world-budget.ts')
  const budget = new WorldBudget()
  const record = { id: 'shape:a', text: 'before' }
  budget.initialize([record]); const before = budget.bytes
  assert.equal(budget.propose('shape:b', { id: 'shape:b', text: 'a'.repeat(LIMITS.worldBytes) }), false)
  assert.equal(budget.bytes, before)
  assert.equal(budget.propose('shape:a', null), true)
  budget.commit([], ['shape:a']); assert.equal(budget.bytes, 0)
  assert.equal(budget.propose(record.id, record), true)
  budget.commit([record], []); assert.equal(budget.bytes, before)
  budget.begin(); assert.equal(budget.propose(record.id, { id: record.id, text: 'a' }), true)
  budget.begin(); assert.equal(budget.bytes, before)
})
