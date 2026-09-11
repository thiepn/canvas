import { useEffect, useState } from 'react'
import { canvasDiagnostics, type DiagnosticsSnapshot } from './metrics.ts'
import { installRuntimePerformanceMetrics } from './performance.ts'

function number(value: number | string | undefined, digits = 0): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function ms(snapshot: DiagnosticsSnapshot, key: string): string {
  const value = snapshot.samples[key]?.p95
  return value === undefined ? '—' : `${value.toFixed(0)} ms`
}

export function DiagnosticsOverlay() {
  const [snapshot, setSnapshot] = useState(() => canvasDiagnostics.snapshot())
  useEffect(() => {
    if (!canvasDiagnostics.enabled) return
    const stop = installRuntimePerformanceMetrics()
    const timer = window.setInterval(() => setSnapshot(canvasDiagnostics.snapshot()), 500)
    return () => { stop(); clearInterval(timer) }
  }, [])

  if (!canvasDiagnostics.enabled) return null
  return <aside className="diagnostics-overlay" aria-label="Canvas diagnostics">
    <strong>Canvas diagnostics</strong>
    <span>FPS <b>{number(snapshot.gauges.fps, 0)}</b></span>
    <span>Frame p95 <b>{ms(snapshot, 'frameMs')}</b></span>
    <span>Long frames <b>{snapshot.counters.longFramesOver50ms ?? 0}</b></span>
    <span>Elements <b>{number(snapshot.gauges.sceneElements)}</b></span>
    <span>In-flight saves <b>{number(snapshot.gauges.pendingWrites)}</b></span>
    <span>Queued finals <b>{number(snapshot.gauges.durableQueueElements)}</b></span>
    <span>Write p95 <b>{ms(snapshot, 'supabaseWriteMs')}</b></span>
    <span>Realtime→frame p95 <b>{ms(snapshot, 'realtimeReceiveToFrameMs')}</b></span>
    <span>Preview→frame p95 <b>{ms(snapshot, 'previewReceiveToFrameMs')}</b></span>
    <span>Preview sent / recv <b>{snapshot.counters.previewBroadcastsSent ?? 0} / {snapshot.counters.previewBroadcastsReceived ?? 0}</b></span>
    <span>Remote previews <b>{number(snapshot.gauges.activeRemotePreviews)}</b></span>
    <span>Initial sync <b>{ms(snapshot, 'initialHydrationMs')}</b></span>
    <span>Reconnect p95 <b>{ms(snapshot, 'reconnectMs')}</b></span>
    <span>Anti-entropy p95 <b>{ms(snapshot, 'antiEntropyMs')}</b></span>
    <span>Reconcile cursor <b>{number(snapshot.gauges.reconciliationCursor)}</b></span>
    <span>Reconcile runs / failures <b>{snapshot.counters.antiEntropyRuns ?? 0} / {snapshot.counters.antiEntropyFailures ?? 0}</b></span>
    <span>Scene observe p95 <b>{ms(snapshot, 'sceneObservationMs')}</b></span>
    <span>Scene changed / skipped <b>{snapshot.counters.sceneElementsChanged ?? 0} / {snapshot.counters.sceneElementsStampSkipped ?? 0}</b></span>
    <span>Hydration pages / commits <b>{number(snapshot.gauges.initialHydrationPages)} / {snapshot.counters.initialHydrationSceneCommits ?? 0}</b></span>
    <span>Writes / gesture <b>{number(snapshot.samples.writesPerGesture?.p95, 1)}</b></span>
    <span>Logical ops <b>{snapshot.counters.logicalMutations ?? 0}</b></span>
    <span>Boundary flushes <b>{snapshot.counters.durabilityBoundaryFlushes ?? 0}</b></span>
    <span>Long-op checkpoints <b>{snapshot.counters.durabilityCheckpoints ?? 0}</b></span>
    <span>Changes / op <b>{number(snapshot.samples.changesPerMutation?.p95, 1)}</b></span>
    {snapshot.gauges.lastMutationKind && <span>Last op <b>{snapshot.gauges.lastMutationKind}</b></span>}
    {typeof snapshot.gauges.jsHeapBytes === 'number' && <span>JS heap <b>{(snapshot.gauges.jsHeapBytes / 1048576).toFixed(1)} MB</b></span>}
    <small>Local diagnostics only · ?debug=1</small>
  </aside>
}
