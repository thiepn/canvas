import { canvasDiagnostics } from './metrics.ts'

export function installRuntimePerformanceMetrics(): () => void {
  if (!canvasDiagnostics.enabled || typeof requestAnimationFrame !== 'function') return () => {}

  let frameId = 0
  let previous = performance.now()
  let fpsWindowStarted = previous
  let frames = 0

  const frame = (timestamp: number) => {
    const frameMs = timestamp - previous
    previous = timestamp
    frames += 1
    canvasDiagnostics.sample('frameMs', frameMs)
    if (frameMs > 50) canvasDiagnostics.increment('longFramesOver50ms')
    if (timestamp - fpsWindowStarted >= 1000) {
      canvasDiagnostics.gauge('fps', frames * 1000 / (timestamp - fpsWindowStarted))
      fpsWindowStarted = timestamp
      frames = 0
    }
    frameId = requestAnimationFrame(frame)
  }
  frameId = requestAnimationFrame(frame)

  const memoryTimer = window.setInterval(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
    if (typeof memory?.usedJSHeapSize === 'number') canvasDiagnostics.gauge('jsHeapBytes', memory.usedJSHeapSize)
  }, 2000)

  return () => {
    cancelAnimationFrame(frameId)
    clearInterval(memoryTimer)
  }
}
