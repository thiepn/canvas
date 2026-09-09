import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

type FixtureLoadResult = { count: number; generationMs: number; renderMs: number }
type FixtureState = { elements: number; scrollX: number; scrollY: number; zoom: number }

export type CanvasPerformanceBridge = {
  loadFixture: (count: number) => Promise<FixtureLoadResult>
  clearFixture: () => Promise<void>
  panBy: (x: number, y: number) => void
  moveFirst: (count: number, x: number, y: number) => void
  selectFirst: (count: number) => void
  serialize: () => { bytes: number; serializationMs: number }
  state: () => FixtureState
  elements: () => readonly SceneElement[]
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function fixtureSkeletons(count: number) {
  const columns = Math.max(10, Math.ceil(Math.sqrt(count)))
  return Array.from({ length: count }, (_, index) => ({
    id: `__perf__${index}`,
    type: 'rectangle' as const,
    x: (index % columns) * 110,
    y: Math.floor(index / columns) * 80,
    width: 80,
    height: 50,
    strokeWidth: 1 as const,
    roughness: 0 as const,
    backgroundColor: index % 7 === 0 ? '#e7f5ff' : 'transparent',
    fillStyle: 'solid' as const,
  }))
}

export function installPerformanceBridge(api: ExcalidrawImperativeAPI, setFixtureIds: (ids: Set<string>) => void): () => void {
  const bridge: CanvasPerformanceBridge = {
    async loadFixture(count) {
      const started = performance.now()
      const elements = convertToExcalidrawElements(fixtureSkeletons(count) as Parameters<typeof convertToExcalidrawElements>[0], { regenerateIds: false })
      const generationMs = performance.now() - started
      setFixtureIds(new Set(elements.map(element => element.id)))
      const renderStarted = performance.now()
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
      await nextFrame()
      await nextFrame()
      return { count, generationMs, renderMs: performance.now() - renderStarted }
    },
    async clearFixture() {
      setFixtureIds(new Set())
      api.updateScene({ elements: [], appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER })
      await nextFrame()
    },
    panBy(x, y) {
      const state = api.getAppState()
      api.updateScene({ appState: { scrollX: state.scrollX + x, scrollY: state.scrollY + y }, captureUpdate: CaptureUpdateAction.NEVER })
    },
    moveFirst(count, x, y) {
      const elements = api.getSceneElementsIncludingDeleted().map((element, index) => index < count ? { ...element, x: element.x + x, y: element.y + y, version: element.version + 1 } : element)
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
    },
    selectFirst(count) {
      const selectedElementIds = Object.fromEntries(api.getSceneElements().slice(0, count).map(element => [element.id, true as const]))
      api.updateScene({ appState: { selectedElementIds }, captureUpdate: CaptureUpdateAction.NEVER })
    },
    serialize() {
      const started = performance.now()
      const json = JSON.stringify(api.getSceneElementsIncludingDeleted())
      return { bytes: new TextEncoder().encode(json).length, serializationMs: performance.now() - started }
    },
    state() {
      const state = api.getAppState()
      return { elements: api.getSceneElements().length, scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value }
    },
    elements: () => api.getSceneElementsIncludingDeleted(),
  }
  window.__CANVAS_PERF__ = bridge
  return () => {
    if (window.__CANVAS_PERF__ === bridge) delete window.__CANVAS_PERF__
  }
}

declare global {
  interface Window {
    __CANVAS_PERF__?: CanvasPerformanceBridge
  }
}
