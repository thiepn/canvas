import { readFile } from 'node:fs/promises'

const [input = 'artifacts/performance.json'] = process.argv.slice(2)
const report = JSON.parse(await readFile(input, 'utf8'))

const budgets = {
  fixture10000: {
    initialRenderMs: 8000,
    panP95Ms: 100,
    moveOneP95Ms: 120,
    moveTwentyP95Ms: 150,
    selectTwentyMs: 3000,
    serializationMs: 2500,
    serializedBytes: 12 * 1024 * 1024,
    jsHeapBytes: 768 * 1024 * 1024,
  },
  collaboration: {
    twoClientOpenToLiveMs: 30000,
    remoteCreateToRenderMs: 15000,
    supabaseWriteP95Ms: 10000,
    realtimeReceiveToFrameP95Ms: 250,
    previewReceiveToFrameP95Ms: 250,
    reconnectObservedMs: 30000,
    diagnosticsReconnectP95Ms: 30000,
    writesPerGestureP95: 3,
    pendingWritesAfterReconnect: 0,
  },
}

const failures = []
const checked = []

function maximum(label, value, limit, optional = false) {
  if (value === null || value === undefined) {
    if (!optional) failures.push(`${label}: missing (limit ${limit})`)
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failures.push(`${label}: invalid value ${JSON.stringify(value)}`)
    return
  }
  checked.push({ label, value, limit })
  if (value > limit) failures.push(`${label}: ${value.toFixed(2)} > ${limit}`)
}

const fixture = [...(report.fixtures ?? [])].find(row => Number(row.count) === 10000)
if (!fixture) {
  failures.push('10,000-element fixture is missing.')
} else {
  maximum('10k initial render ms', fixture.initialRenderMs, budgets.fixture10000.initialRenderMs)
  maximum('10k pan p95 frame ms', fixture.pan?.p95FrameMs, budgets.fixture10000.panP95Ms)
  maximum('10k move-one p95 frame ms', fixture.moveOne?.p95FrameMs, budgets.fixture10000.moveOneP95Ms)
  maximum('10k move-20 p95 frame ms', fixture.moveTwenty?.p95FrameMs, budgets.fixture10000.moveTwentyP95Ms)
  maximum('10k select-20 ms', fixture.selectTwentyMs, budgets.fixture10000.selectTwentyMs)
  maximum('10k serialization ms', fixture.serializationMs, budgets.fixture10000.serializationMs)
  maximum('10k serialized bytes', fixture.serializedBytes, budgets.fixture10000.serializedBytes)
  maximum('10k JS heap bytes', fixture.jsHeapBytes, budgets.fixture10000.jsHeapBytes, true)
}

const collab = report.collaboration ?? {}
maximum('two clients → Live ms', collab.twoClientOpenToLiveMs, budgets.collaboration.twoClientOpenToLiveMs)
maximum('local create → peer render ms', collab.remoteCreateToRenderMs, budgets.collaboration.remoteCreateToRenderMs)
maximum('Supabase write p95 ms', collab.supabaseWriteP95Ms, budgets.collaboration.supabaseWriteP95Ms, true)
maximum('Realtime receive → frame p95 ms', collab.realtimeReceiveToFrameP95Ms, budgets.collaboration.realtimeReceiveToFrameP95Ms, true)
maximum('Preview receive → frame p95 ms', collab.previewReceiveToFrameP95Ms, budgets.collaboration.previewReceiveToFrameP95Ms, true)
maximum('offline → Live observed ms', collab.reconnectObservedMs, budgets.collaboration.reconnectObservedMs)
maximum('internal reconnect p95 ms', collab.diagnosticsReconnectP95Ms, budgets.collaboration.diagnosticsReconnectP95Ms, true)
maximum('writes per gesture p95', collab.writesPerGestureP95, budgets.collaboration.writesPerGestureP95, true)
maximum('pending writes after reconnect', collab.pendingWritesAfterReconnect, budgets.collaboration.pendingWritesAfterReconnect, true)

console.log('Canvas Phase 9 performance budget')
for (const item of checked) console.log(`  ✓ ${item.label}: ${item.value.toFixed(2)} ≤ ${item.limit}`)

if (failures.length) {
  console.error('\nPerformance budget failed:')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nAll enforced performance budgets passed.')
}
