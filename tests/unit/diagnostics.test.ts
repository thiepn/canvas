import assert from 'node:assert/strict'
import test from 'node:test'
import { CanvasDiagnostics, diagnosticsRequested } from '../../app/diagnostics/metrics.ts'

test('diagnostics are opt-in except in performance mode', () => {
  assert.equal(diagnosticsRequested('', 'production'), false)
  assert.equal(diagnosticsRequested('?debug=1', 'production'), true)
  assert.equal(diagnosticsRequested('?debug=0', 'production'), false)
  assert.equal(diagnosticsRequested('', 'performance'), true)
})

test('diagnostics calculate bounded metric summaries and counters', () => {
  const diagnostics = new CanvasDiagnostics()
  diagnostics.enable()
  for (let value = 1; value <= 400; value++) diagnostics.sample('latency', value)
  diagnostics.increment('writes', 2)
  diagnostics.gauge('pending', 3)
  const snapshot = diagnostics.snapshot()
  assert.equal(snapshot.samples.latency.count, 360)
  assert.equal(snapshot.samples.latency.min, 41)
  assert.equal(snapshot.samples.latency.max, 400)
  assert.equal(snapshot.samples.latency.p50, 220)
  assert.equal(snapshot.samples.latency.p95, 382)
  assert.equal(snapshot.counters.writes, 2)
  assert.equal(snapshot.gauges.pending, 3)
})

test('disabled diagnostics are no-ops', () => {
  const diagnostics = new CanvasDiagnostics()
  diagnostics.sample('latency', 10)
  diagnostics.increment('writes')
  diagnostics.gauge('pending', 1)
  const snapshot = diagnostics.snapshot()
  assert.deepEqual(snapshot.samples, {})
  assert.deepEqual(snapshot.counters, {})
  assert.deepEqual(snapshot.gauges, {})
})
