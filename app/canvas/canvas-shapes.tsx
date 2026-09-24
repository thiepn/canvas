import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { canvasDiagnostics } from '../diagnostics/metrics.ts'
import { SpatialGridIndex, viewportBounds } from './spatial-index.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

export type CanvasShapeKind = 'rounded-rectangle' | 'triangle' | 'polygon' | 'hexagon' | 'star' | 'speech-bubble' | 'cloud' | 'heart' | 'check' | 'sparkle' | 'pin' | 'flag' | 'bolt'
export type CanvasShapeStrokeStyle = 'solid' | 'dashed' | 'dotted'
export type CanvasShapeFillStyle = 'transparent' | 'solid' | 'hachure'

export type CanvasShapeStyle = {
  strokeColor: string
  fillColor: string
  strokeWidth: number
  strokeStyle: CanvasShapeStrokeStyle
  fillStyle: CanvasShapeFillStyle
  opacity: number
  cornerRadius: number
}

export type CanvasShapeData = {
  version: 1
  kind: CanvasShapeKind
  sides: number
  style: CanvasShapeStyle
}

export type CanvasShapeLayerHandle = {
  sync: (elements: readonly SceneElement[], appState: AppState) => void
}

type ShapeSnapshot = {
  elements: SceneElement[]
  scrollX: number
  scrollY: number
  zoom: number
}

const SHAPE_KEY = 'canvasShape'
const SHAPE_KINDS = new Set<CanvasShapeKind>(['rounded-rectangle', 'triangle', 'polygon', 'hexagon', 'star', 'speech-bubble', 'cloud', 'heart', 'check', 'sparkle', 'pin', 'flag', 'bolt'])
const DEFAULT_STYLE: CanvasShapeStyle = {
  strokeColor: '#1f2937',
  fillColor: '#e7f5ff',
  strokeWidth: 2,
  strokeStyle: 'solid',
  fillStyle: 'solid',
  opacity: 100,
  cornerRadius: 18,
}

const safeColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && (/^#[0-9a-f]{6}$/i.test(value) || value === 'transparent') ? value : fallback
const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export function normalizeCanvasShapeStyle(value: unknown): CanvasShapeStyle {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const strokeStyle = input.strokeStyle === 'dashed' || input.strokeStyle === 'dotted' ? input.strokeStyle : 'solid'
  const fillStyle = input.fillStyle === 'transparent' || input.fillStyle === 'hachure' ? input.fillStyle : 'solid'
  return {
    strokeColor: safeColor(input.strokeColor, DEFAULT_STYLE.strokeColor),
    fillColor: safeColor(input.fillColor, DEFAULT_STYLE.fillColor),
    strokeWidth: clamp(input.strokeWidth, DEFAULT_STYLE.strokeWidth, 0.5, 20),
    strokeStyle,
    fillStyle,
    opacity: clamp(input.opacity, DEFAULT_STYLE.opacity, 5, 100),
    cornerRadius: clamp(input.cornerRadius, DEFAULT_STYLE.cornerRadius, 0, 64),
  }
}

export function canvasShapeData(element: SceneElement): CanvasShapeData | null {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData
  const value = customData?.[SHAPE_KEY]
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.kind !== 'string' || !SHAPE_KINDS.has(input.kind as CanvasShapeKind)) return null
  return {
    version: 1,
    kind: input.kind as CanvasShapeKind,
    sides: Math.round(clamp(input.sides, input.kind === 'hexagon' ? 6 : 5, 3, 12)),
    style: normalizeCanvasShapeStyle(input.style),
  }
}

export function isCanvasShapeElement(element: SceneElement): boolean {
  return element.type === 'rectangle' && !element.isDeleted && canvasShapeData(element) !== null
}

export function createCanvasShapeElement(options: {
  kind: CanvasShapeKind
  x: number
  y: number
  width?: number
  height?: number
  style?: Partial<CanvasShapeStyle>
  sides?: number
}): SceneElement {
  const width = Math.max(48, options.width ?? 180)
  const height = Math.max(48, options.height ?? 120)
  const [base] = convertToExcalidrawElements([{
    type: 'rectangle',
    x: options.x,
    y: options.y,
    width,
    height,
    strokeColor: '#ffffff',
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    opacity: 0,
  }]) as unknown as SceneElement[]
  if (!base) throw new Error('Could not create Canvas shape.')
  const customData = (base as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...base,
    opacity: 0,
    customData: {
      ...customData,
      [SHAPE_KEY]: {
        version: 1,
        kind: options.kind,
        sides: Math.round(clamp(options.sides, options.kind === 'hexagon' ? 6 : 5, 3, 12)),
        style: normalizeCanvasShapeStyle({ ...DEFAULT_STYLE, ...options.style }),
      } satisfies CanvasShapeData,
    },
  } as SceneElement
}

export function updateCanvasShapeElement(
  element: SceneElement,
  patch: { kind?: CanvasShapeKind; sides?: number; style?: Partial<CanvasShapeStyle> },
): SceneElement {
  const data = canvasShapeData(element)
  if (!data) return element
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...element,
    version: element.version + 1,
    versionNonce: globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
      : Math.floor(Math.random() * 0x7fffffff),
    updated: Date.now(),
    customData: {
      ...customData,
      [SHAPE_KEY]: {
        version: 1,
        kind: patch.kind ?? data.kind,
        sides: Math.round(clamp(patch.sides, data.sides, 3, 12)),
        style: normalizeCanvasShapeStyle({ ...data.style, ...patch.style }),
      } satisfies CanvasShapeData,
    },
  } as SceneElement
}

function positionStyle(element: SceneElement, snapshot: ShapeSnapshot): CSSProperties {
  const zoom = Math.max(0.01, snapshot.zoom)
  const centerX = (element.x + element.width / 2 + snapshot.scrollX) * zoom
  const centerY = (element.y + element.height / 2 + snapshot.scrollY) * zoom
  return {
    width: element.width,
    height: element.height,
    left: centerX - element.width / 2,
    top: centerY - element.height / 2,
    transform: `scale(${zoom}) rotate(${element.angle}rad)`,
    transformOrigin: 'center center',
  }
}

function dashArray(style: CanvasShapeStrokeStyle): string | undefined {
  if (style === 'dashed') return '10 7'
  if (style === 'dotted') return '2 6'
  return undefined
}

function starPoints(width: number, height: number): string {
  const cx = width / 2
  const cy = height / 2
  const outer = Math.min(width, height) * 0.48
  const inner = outer * 0.46
  const points: string[] = []
  for (let index = 0; index < 10; index++) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + index * Math.PI / 5
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`)
  }
  return points.join(' ')
}

function polygonPoints(width: number, height: number, sides: number): string {
  const count = Math.max(3, Math.min(12, Math.round(sides)))
  const cx = width / 2
  const cy = height / 2
  const rx = Math.max(1, width / 2 - 2)
  const ry = Math.max(1, height / 2 - 2)
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count
    return `${cx + Math.cos(angle) * rx},${cy + Math.sin(angle) * ry}`
  }).join(' ')
}

function ShapeGraphic({ element, data }: { element: SceneElement; data: CanvasShapeData }) {
  const width = Math.max(1, element.width)
  const height = Math.max(1, element.height)
  const style = data.style
  const patternId = `shape-hatch-${element.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const fill = style.fillStyle === 'transparent'
    ? 'none'
    : style.fillStyle === 'hachure'
      ? `url(#${patternId})`
      : style.fillColor
  const shared = {
    fill,
    stroke: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeDasharray: dashArray(style.strokeStyle),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const cloud = `M ${width * .22} ${height * .73}
    C ${width * .08} ${height * .73}, ${width * .05} ${height * .48}, ${width * .22} ${height * .42}
    C ${width * .22} ${height * .22}, ${width * .46} ${height * .13}, ${width * .58} ${height * .30}
    C ${width * .72} ${height * .18}, ${width * .91} ${height * .29}, ${width * .86} ${height * .48}
    C ${width * .98} ${height * .57}, ${width * .91} ${height * .76}, ${width * .74} ${height * .75}
    Z`
  const bubble = `M ${style.cornerRadius} 0 H ${width - style.cornerRadius}
    Q ${width} 0 ${width} ${style.cornerRadius}
    V ${height * .70}
    Q ${width} ${height * .78} ${width - style.cornerRadius} ${height * .78}
    H ${width * .40} L ${width * .23} ${height}
    L ${width * .27} ${height * .78} H ${style.cornerRadius}
    Q 0 ${height * .78} 0 ${height * .70}
    V ${style.cornerRadius} Q 0 0 ${style.cornerRadius} 0 Z`
  const heart = `M ${width * .5} ${height * .88}
    C ${width * .42} ${height * .78}, ${width * .08} ${height * .57}, ${width * .08} ${height * .30}
    C ${width * .08} ${height * .08}, ${width * .36} ${height * .02}, ${width * .5} ${height * .22}
    C ${width * .64} ${height * .02}, ${width * .92} ${height * .08}, ${width * .92} ${height * .30}
    C ${width * .92} ${height * .57}, ${width * .58} ${height * .78}, ${width * .5} ${height * .88} Z`
  const pin = `M ${width * .5} ${height * .94}
    C ${width * .40} ${height * .72}, ${width * .22} ${height * .56}, ${width * .22} ${height * .36}
    A ${width * .28} ${height * .28} 0 1 1 ${width * .78} ${height * .36}
    C ${width * .78} ${height * .56}, ${width * .60} ${height * .72}, ${width * .5} ${height * .94} Z`

  const stampFill = { fill: style.strokeColor, stroke: 'none', opacity: style.opacity / 100 }

  return <svg className="canvas-shape-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
    {style.fillStyle === 'hachure' && <defs>
      <pattern id={patternId} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(35)">
        <rect width="10" height="10" fill={style.fillColor} fillOpacity=".18" />
        <line x1="0" y1="0" x2="0" y2="10" stroke={style.fillColor} strokeWidth="2" opacity=".75" />
      </pattern>
    </defs>}
    {data.kind === 'rounded-rectangle' && <rect x={style.strokeWidth / 2} y={style.strokeWidth / 2} width={Math.max(1, width - style.strokeWidth)} height={Math.max(1, height - style.strokeWidth)} rx={Math.min(style.cornerRadius, width / 2, height / 2)} {...shared} />}
    {data.kind === 'triangle' && <polygon points={`${width / 2},2 ${width - 2},${height - 2} 2,${height - 2}`} {...shared} />}
    {data.kind === 'polygon' && <polygon points={polygonPoints(width, height, data.sides)} {...shared} />}
    {data.kind === 'hexagon' && <polygon points={`${width * .25},2 ${width * .75},2 ${width - 2},${height / 2} ${width * .75},${height - 2} ${width * .25},${height - 2} 2,${height / 2}`} {...shared} />}
    {data.kind === 'star' && <polygon points={starPoints(width, height)} {...shared} />}
    {data.kind === 'speech-bubble' && <path d={bubble} {...shared} />}
    {data.kind === 'cloud' && <path d={cloud} {...shared} />}
    {data.kind === 'heart' && <path d={heart} {...stampFill} />}
    {data.kind === 'check' && <polyline points={`${width * .14},${height * .53} ${width * .40},${height * .78} ${width * .86},${height * .22}`} fill="none" stroke={style.strokeColor} strokeWidth={Math.max(7, style.strokeWidth * 3.2)} strokeLinecap="round" strokeLinejoin="round" opacity={style.opacity / 100} />}
    {data.kind === 'sparkle' && <polygon points={`${width * .5},2 ${width * .62},${height * .37} ${width - 2},${height * .5} ${width * .62},${height * .63} ${width * .5},${height - 2} ${width * .38},${height * .63} 2,${height * .5} ${width * .38},${height * .37}`} {...stampFill} />}
    {data.kind === 'pin' && <path d={pin} {...stampFill} />}
    {data.kind === 'pin' && <circle cx={width * .5} cy={height * .36} r={Math.min(width, height) * .10} fill="var(--panel,#fff)" opacity=".9" />}
    {data.kind === 'flag' && <>
      <rect x={width * .23} y={height * .10} width={Math.max(6, width * .08)} height={height * .80} rx={Math.max(3, width * .03)} {...stampFill} />
      <path d={`M ${width * .31} ${height * .14} H ${width * .82} L ${width * .68} ${height * .36} L ${width * .82} ${height * .58} H ${width * .31} Z`} {...stampFill} />
    </>}
    {data.kind === 'bolt' && <polygon points={`${width * .56},2 ${width * .20},${height * .55} ${width * .46},${height * .55} ${width * .36},${height - 2} ${width * .82},${height * .40} ${width * .57},${height * .40}`} {...stampFill} />}
  </svg>
}

export const CanvasShapeLayer = forwardRef<CanvasShapeLayerHandle>(function CanvasShapeLayer(_, ref) {
  const [snapshot, setSnapshot] = useState<ShapeSnapshot>({ elements: [], scrollX: 0, scrollY: 0, zoom: 1 })
  const snapshotRef = useRef(snapshot)
  const pendingRef = useRef<ShapeSnapshot | null>(null)
  const frameRef = useRef<number | null>(null)
  const spatialIndexRef = useRef(new SpatialGridIndex<SceneElement>(512))

  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])
  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }, [])

  useImperativeHandle(ref, () => ({
    sync(elements, appState) {
      const stats = spatialIndexRef.current.sync(elements, isCanvasShapeElement)
      const custom = spatialIndexRef.current.query(viewportBounds(appState, 320))
      canvasDiagnostics.gauge('customShapeIndexSize', stats.indexed)
      canvasDiagnostics.gauge('customShapeVisible', custom.length)
      canvasDiagnostics.sample('customShapeCullRatio', stats.indexed ? custom.length / stats.indexed : 0)
      if (!custom.length && !snapshotRef.current.elements.length) return
      pendingRef.current = {
        elements: custom,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
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

  return <div className="canvas-shape-layer" aria-hidden="true">
    {snapshot.elements.map(element => {
      const data = canvasShapeData(element)
      if (!data) return null
      return <div key={element.id} className="canvas-custom-shape" style={{ ...positionStyle(element, snapshot), opacity: data.style.opacity / 100 }}>
        <ShapeGraphic element={element} data={data} />
      </div>
    })}
  </div>
})
