import { canvasDiagnostics } from './metrics.ts'

type ConnectionKind = 'initial' | 'reconnect'

class SyncDiagnostics {
  private connectionStartedAt: number | null = null
  private connectionKind: ConnectionKind = 'initial'
  private hasBeenLive = false
  private gestureWriteStart = 0
  private gestureToken = 0
  private gestureActive = false
  private gestureTimer: ReturnType<typeof setTimeout> | null = null

  connectionState(state: string): void {
    canvasDiagnostics.gauge('connectionState', state)
  }

  connectionAttempt(): void {
    if (!canvasDiagnostics.enabled) return
    this.connectionStartedAt = performance.now()
    this.connectionKind = this.hasBeenLive ? 'reconnect' : 'initial'
  }

  live(): void {
    if (!canvasDiagnostics.enabled) return
    if (this.connectionStartedAt !== null) {
      const elapsed = performance.now() - this.connectionStartedAt
      canvasDiagnostics.sample(this.connectionKind === 'initial' ? 'initialHydrationMs' : 'reconnectMs', elapsed)
    }
    this.connectionStartedAt = null
    this.hasBeenLive = true
    this.connectionState('Live')
  }

  hydrationQuery(durationMs: number, rows: number): void {
    canvasDiagnostics.sample('hydrationQueryMs', durationMs)
    canvasDiagnostics.gauge('serverRows', rows)
  }

  pending(depth: number): void {
    canvasDiagnostics.gauge('pendingWrites', depth)
  }

  elements(count: number): void {
    canvasDiagnostics.gauge('sceneElements', count)
  }

  write(rows: number, durationMs: number, ok: boolean): void {
    canvasDiagnostics.increment('dbWriteBatches')
    canvasDiagnostics.increment('dbRowsWritten', rows)
    canvasDiagnostics.sample('supabaseWriteMs', durationMs)
    if (!ok) canvasDiagnostics.increment('dbWriteFailures')
  }

  realtimeApply(startedAt: number): void {
    if (!canvasDiagnostics.enabled) return
    requestAnimationFrame(() => canvasDiagnostics.sample('realtimeReceiveToFrameMs', performance.now() - startedAt))
  }

  beginGesture(): void {
    if (!canvasDiagnostics.enabled) return
    this.gestureActive = true
    this.gestureToken += 1
    this.gestureWriteStart = canvasDiagnostics.counter('dbWriteBatches')
    if (this.gestureTimer) clearTimeout(this.gestureTimer)
  }

  endGesture(): void {
    if (!canvasDiagnostics.enabled || !this.gestureActive) return
    this.gestureActive = false
    const token = this.gestureToken
    if (this.gestureTimer) clearTimeout(this.gestureTimer)
    this.gestureTimer = setTimeout(() => {
      if (token !== this.gestureToken) return
      const writes = canvasDiagnostics.counter('dbWriteBatches') - this.gestureWriteStart
      canvasDiagnostics.sample('writesPerGesture', writes)
      this.gestureTimer = null
    }, 650)
  }
}

export const syncDiagnostics = new SyncDiagnostics()
