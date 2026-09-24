import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  searchSpatialElements,
  spatialBounds,
  spatialElementBounds,
  viewportSceneBounds,
  type SpatialElementLike,
} from './spatial-navigation.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

type NavigationSnapshot = {
  elements: SceneElement[]
  scrollX: number
  scrollY: number
  zoom: number
  width: number
  height: number
}

export type NavigationOverlayHandle = {
  sync: (elements: readonly SceneElement[], appState: AppState) => void
}

type Props = {
  api: ExcalidrawImperativeAPI | null
  onSelectionRefresh: () => void
}

const HOME_KEY = 'canvas.home-view.v1'
const MAP_WIDTH = 184
const MAP_HEIGHT = 122

function readHome(): { x: number; y: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(HOME_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    const x = Number(value.x), y = Number(value.y), zoom = Number(value.zoom)
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) ? { x, y, zoom } : null
  } catch {
    return null
  }
}

function writeHome(value: { x: number; y: number; zoom: number }) {
  try { localStorage.setItem(HOME_KEY, JSON.stringify(value)) } catch { /* Device-local preference only. */ }
}

function frameLabel(element: SceneElement, index: number): string {
  const name = element.type === 'frame' ? element.name?.trim() : ''
  return name || `Frame ${index + 1}`
}

export const NavigationOverlay = forwardRef<NavigationOverlayHandle, Props>(function NavigationOverlay({ api, onSelectionRefresh }, ref) {
  const [snapshot, setSnapshot] = useState<NavigationSnapshot>({ elements: [], scrollX: 0, scrollY: 0, zoom: 1, width: 1, height: 1 })
  const snapshotRef = useRef(snapshot)
  const pendingRef = useRef<NavigationSnapshot | null>(null)
  const frameRef = useRef<number | null>(null)
  const [panel, setPanel] = useState<'search' | 'frames' | null>(null)
  const [showMap, setShowMap] = useState(true)
  const [query, setQuery] = useState('')
  const [activeResult, setActiveResult] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [home, setHome] = useState(() => readHome())

  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])
  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }, [])

  useImperativeHandle(ref, () => ({
    sync(elements, appState) {
      pendingRef.current = {
        elements: elements.filter(element => !element.isDeleted),
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
        width: appState.width,
        height: appState.height,
      }
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const next = pendingRef.current
        pendingRef.current = null
        if (next) setSnapshot(next)
      })
    },
  }), [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        setPanel('search')
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [])

  const results = useMemo(
    () => searchSpatialElements(snapshot.elements as unknown as SpatialElementLike[], query),
    [query, snapshot.elements],
  )
  useEffect(() => setActiveResult(0), [query])

  const frames = useMemo(
    () => snapshot.elements.filter(element => element.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x),
    [snapshot.elements],
  )

  if (!api) return null

  const refreshFromApi = () => {
    requestAnimationFrame(() => {
      const current = api.getAppState()
      setSnapshot({
        elements: [...api.getSceneElements()],
        scrollX: current.scrollX,
        scrollY: current.scrollY,
        zoom: current.zoom.value,
        width: current.width,
        height: current.height,
      })
    })
  }

  const state = api.getAppState()
  const zoomPercent = Math.round(state.zoom.value * 100)
  const viewport = viewportSceneBounds({
    scrollX: snapshot.scrollX,
    scrollY: snapshot.scrollY,
    zoom: { value: snapshot.zoom },
    width: snapshot.width,
    height: snapshot.height,
  })

  const navigateTo = (elements: SceneElement[], fit = true) => {
    if (!elements.length) return
    api.scrollToContent(elements, {
      fitToContent: fit,
      animate: true,
      duration: 300,
      viewportZoomFactor: 0.72,
    })
  }

  const fitAll = () => navigateTo([...api.getSceneElements()], true)

  const fitSelection = () => {
    const selectedIds = api.getAppState().selectedElementIds
    const selected = api.getSceneElements().filter(element => selectedIds[element.id])
    if (selected.length) navigateTo(selected, true)
  }

  const fitFrame = () => {
    const appState = api.getAppState()
    const selected = api.getSceneElements().filter(element => appState.selectedElementIds[element.id])
    const direct = selected.find(element => element.type === 'frame')
    const frameId = direct?.id ?? selected.find(element => element.frameId)?.frameId
    const frame = frameId ? api.getSceneElements().find(element => element.id === frameId && element.type === 'frame') : null
    if (frame) navigateTo([frame], true)
  }

  const setZoom = (value: number) => {
    const current = api.getAppState()
    const nextZoom = Math.max(0.1, Math.min(4, value))
    const centerX = current.width / (2 * current.zoom.value) - current.scrollX
    const centerY = current.height / (2 * current.zoom.value) - current.scrollY
    api.updateScene({
      appState: {
        zoom: { value: nextZoom } as AppState['zoom'],
        scrollX: current.width / (2 * nextZoom) - centerX,
        scrollY: current.height / (2 * nextZoom) - centerY,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    refreshFromApi()
  }

  const goToElement = (element: SceneElement, select = true) => {
    if (select) {
      api.updateScene({
        appState: {
          selectedElementIds: { [element.id]: true },
          selectedGroupIds: {},
          editingGroupId: null,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
      requestAnimationFrame(onSelectionRefresh)
    }
    navigateTo([element], true)
  }

  const goToResult = (index: number) => {
    if (!results.length) return
    const normalized = (index + results.length) % results.length
    setActiveResult(normalized)
    const result = results[normalized]
    const element = api.getSceneElements().find(item => item.id === result.id)
    if (element) goToElement(element)
  }

  const setCurrentHome = () => {
    const current = api.getAppState()
    const bounds = viewportSceneBounds(current)
    const next = { x: bounds.midX, y: bounds.midY, zoom: current.zoom.value }
    writeHome(next)
    setHome(next)
  }

  const goHome = () => {
    if (!home) {
      fitAll()
      return
    }
    const current = api.getAppState()
    api.updateScene({
      appState: {
        zoom: { value: Math.max(0.1, Math.min(4, home.zoom)) } as AppState['zoom'],
        scrollX: current.width / (2 * home.zoom) - home.x,
        scrollY: current.height / (2 * home.zoom) - home.y,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    refreshFromApi()
  }

  const activeElements = snapshot.elements.filter(element => element.type !== 'text' || !element.containerId)
  const scene = spatialBounds(activeElements as unknown as SpatialElementLike[])
  const mapBounds = (() => {
    if (!scene) return viewport
    const minX = Math.min(scene.minX, viewport.minX)
    const minY = Math.min(scene.minY, viewport.minY)
    const maxX = Math.max(scene.maxX, viewport.maxX)
    const maxY = Math.max(scene.maxY, viewport.maxY)
    const rawWidth = Math.max(200, maxX - minX)
    const rawHeight = Math.max(140, maxY - minY)
    const pad = Math.max(40, Math.max(rawWidth, rawHeight) * 0.06)
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
      width: rawWidth + pad * 2,
      height: rawHeight + pad * 2,
      midX: (minX + maxX) / 2,
      midY: (minY + maxY) / 2,
    }
  })()
  const scale = Math.min(MAP_WIDTH / Math.max(1, mapBounds.width), MAP_HEIGHT / Math.max(1, mapBounds.height))
  const offsetX = (MAP_WIDTH - mapBounds.width * scale) / 2
  const offsetY = (MAP_HEIGHT - mapBounds.height * scale) / 2
  const projectX = (x: number) => offsetX + (x - mapBounds.minX) * scale
  const projectY = (y: number) => offsetY + (y - mapBounds.minY) * scale

  const mapElements = (() => {
    const framesOnMap = activeElements.filter(element => element.type === 'frame')
    const others = activeElements.filter(element => element.type !== 'frame')
    if (others.length <= 240) return [...others, ...framesOnMap]
    const step = Math.ceil(others.length / 220)
    return [...others.filter((_, index) => index % step === 0), ...framesOnMap]
  })()

  const handleMapPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const mapX = (event.clientX - rect.left) / Math.max(1, rect.width) * MAP_WIDTH
    const mapY = (event.clientY - rect.top) / Math.max(1, rect.height) * MAP_HEIGHT
    const x = mapBounds.minX + ((mapX - offsetX) / Math.max(0.0001, scale))
    const y = mapBounds.minY + ((mapY - offsetY) / Math.max(0.0001, scale))
    const current = api.getAppState()
    api.updateScene({
      appState: {
        scrollX: current.width / (2 * current.zoom.value) - x,
        scrollY: current.height / (2 * current.zoom.value) - y,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    refreshFromApi()
  }

  return <div className="navigation-overlay">
    {showMap && <div className="canvas-minimap" aria-label="Canvas minimap">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} onPointerDown={handleMapPointer}>
        {mapElements.map(element => {
          const bounds = spatialElementBounds(element as unknown as SpatialElementLike)
          const x = projectX(bounds.minX)
          const y = projectY(bounds.minY)
          const width = Math.max(1.5, bounds.width * scale)
          const height = Math.max(1.5, bounds.height * scale)
          return <rect
            key={element.id}
            x={x}
            y={y}
            width={width}
            height={height}
            rx={element.type === 'frame' ? 1.5 : 0.6}
            className={element.type === 'frame' ? 'minimap-frame' : 'minimap-object'}
          />
        })}
        <rect
          className="minimap-viewport"
          x={projectX(viewport.minX)}
          y={projectY(viewport.minY)}
          width={Math.max(4, viewport.width * scale)}
          height={Math.max(4, viewport.height * scale)}
        />
      </svg>
      <div className="minimap-coordinates">{Math.round(viewport.midX)}, {Math.round(viewport.midY)}</div>
    </div>}

    <div className="navigation-toolbar" role="toolbar" aria-label="Canvas navigation">
      <button type="button" aria-label="Search canvas" title="Search canvas (Ctrl/⌘ F)" onClick={() => { setPanel('search'); requestAnimationFrame(() => searchInputRef.current?.focus()) }}>Search</button>
      <button type="button" aria-label="Show frames" onClick={() => setPanel(panel === 'frames' ? null : 'frames')}>Frames</button>
      <button type="button" aria-label="Toggle minimap" aria-pressed={showMap} className={showMap ? 'is-active' : ''} onClick={() => setShowMap(value => !value)}>Map</button>
      <button type="button" aria-label="Fit all content" onClick={fitAll}>Fit</button>
      <button type="button" aria-label="Zoom to selection" disabled={!Object.values(state.selectedElementIds).some(Boolean)} onClick={fitSelection}>Sel</button>
      <button type="button" aria-label="Zoom to frame" onClick={fitFrame}>Frame</button>
      <button type="button" aria-label="Go to home view" onClick={goHome}>Home</button>
      <span className="navigation-zoom">{zoomPercent}%</span>
      <details className="navigation-zoom-presets">
        <summary aria-label="Zoom presets">Zoom</summary>
        <div>
          {[0.5, 1, 2].map(value => <button key={value} type="button" onClick={() => setZoom(value)}>{Math.round(value * 100)}%</button>)}
          <button type="button" onClick={setCurrentHome}>Set home</button>
        </div>
      </details>
    </div>

    {panel === 'search' && <div className="navigation-panel navigation-search-panel" aria-label="Canvas search">
      <div className="navigation-panel-heading">
        <strong>Search canvas</strong>
        <button type="button" aria-label="Close search" onClick={() => setPanel(null)}>×</button>
      </div>
      <input
        ref={searchInputRef}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); goToResult(activeResult + 1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); goToResult(activeResult - 1) }
          if (event.key === 'Enter') { event.preventDefault(); goToResult(activeResult) }
        }}
        placeholder="Find text or frames…"
        aria-label="Search canvas text"
      />
      <div className="navigation-search-meta">
        <span>{query ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Type to search the canvas'}</span>
        {results.length > 0 && <span>
          <button type="button" onClick={() => goToResult(activeResult - 1)}>Prev</button>
          <button type="button" onClick={() => goToResult(activeResult + 1)}>Next</button>
        </span>}
      </div>
      <div className="navigation-result-list">
        {results.map((result, index) => <button
          type="button"
          key={result.id}
          className={index === activeResult ? 'is-active' : ''}
          onClick={() => goToResult(index)}
        >
          <span className="navigation-result-type">{result.type === 'rich-text' ? 'Rich text' : result.type === 'frame' ? 'Frame' : 'Text'}</span>
          <span>{result.label}</span>
        </button>)}
      </div>
    </div>}

    {panel === 'frames' && <div className="navigation-panel navigation-frame-panel" aria-label="Canvas frames">
      <div className="navigation-panel-heading">
        <strong>Frames</strong>
        <button type="button" aria-label="Close frames" onClick={() => setPanel(null)}>×</button>
      </div>
      <div className="navigation-result-list">
        {frames.length ? frames.map((frame, index) => <button type="button" key={frame.id} onClick={() => goToElement(frame)}>
          <span className="navigation-result-type">Frame {index + 1}</span>
          <span>{frameLabel(frame, index)}</span>
        </button>) : <p className="navigation-empty">No frames yet.</p>}
      </div>
    </div>}
  </div>
})
