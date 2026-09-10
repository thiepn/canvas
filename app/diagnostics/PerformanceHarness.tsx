import { useEffect, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { installPerformanceBridge } from './performance-fixture.ts'

export function PerformanceHarness() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    if (!api) return
    return installPerformanceBridge(api, () => {})
  }, [api])
  return <main className="performance-harness" data-canvas-engine="excalidraw-performance-fixture" aria-label="Canvas performance fixture">
    <Excalidraw excalidrawAPI={setApi} UIOptions={{ canvasActions: { export: false, loadScene: false, saveAsImage: false, saveToActiveFile: false } }} />
  </main>
}
