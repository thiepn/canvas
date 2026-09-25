import { canvasDiagnostics } from './metrics.ts'

export function installRuntimePerformanceMetrics(): () => void {
  if (!canvasDiagnostics.enabled || typeof requestAnimationFrame !== 'function') return () => {}

  let frameId = 0
  let previous = performance.now()
  let fpsWindowStarted = previous
  let frames = 0

  const frame = (timestamp: number) => {
    if (document.visibilityState !== 'visible') {
      previous = timestamp
      fpsWindowStarted = timestamp
      frames = 0
      frameId = requestAnimationFrame(frame)
      return
    }
    const frameMs = timestamp - previous
    previous = timestamp
    frames += 1
    canvasDiagnostics.sample('frameMs', frameMs)
    if (frameMs > 50) canvasDiagnostics.increment('longFramesOver50ms')
    if (timestamp - fpsWindowStarted >= 1000) {
      canvasDiagnostics.gauge('fps', frames * 1000 / Math.max(1, timestamp - fpsWindowStarted))
      fpsWindowStarted = timestamp
      frames = 0
    }
    frameId = requestAnimationFrame(frame)
  }
  frameId = requestAnimationFrame(frame)

  const visibility = () => {
    const timestamp = performance.now()
    previous = timestamp
    fpsWindowStarted = timestamp
    frames = 0
  }
  document.addEventListener('visibilitychange', visibility)

  let longTaskObserver: PerformanceObserver | null = null
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    try {
      longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          canvasDiagnostics.increment('longTasks')
          canvasDiagnostics.sample('longTaskMs', entry.duration)
        }
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
      longTaskObserver = null
    }
  }

  const memoryTimer = window.setInterval(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
    if (typeof memory?.usedJSHeapSize === 'number') canvasDiagnostics.gauge('jsHeapBytes', memory.usedJSHeapSize)
  }, 2000)

  return () => {
    cancelAnimationFrame(frameId)
    clearInterval(memoryTimer)
    document.removeEventListener('visibilitychange', visibility)
    longTaskObserver?.disconnect()
  }
}
