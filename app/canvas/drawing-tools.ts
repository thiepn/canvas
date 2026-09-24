import { generateNKeysBetween } from 'fractional-indexing'

export type ScenePoint = readonly [number, number]
export type DrawingMode = 'pen' | 'highlighter' | 'partial-eraser' | 'object-eraser'

export type DrawingElementLike = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  version: number
  versionNonce: number
  isDeleted: boolean
  updated?: number
  index?: string | null
  seed?: number
  points?: readonly ScenePoint[]
  pressures?: readonly number[]
  simulatePressure?: boolean
  strokeOptions?: { variability?: 'variable' | 'constant'; streamline?: number; [key: string]: unknown }
  strokeWidth?: number
  strokeColor?: string
  strokeStyle?: string
  roughness?: number
  opacity?: number
  frameId?: string | null
  groupIds?: readonly string[]
  customData?: Record<string, unknown>
  [key: string]: unknown
}

export type FinishedStrokeStyle = {
  mode: 'pen' | 'highlighter'
  color: string
  width: number
  smoothing: number
  pressure: boolean
  opacity: number
}

export type CleanStrokeRecognition =
  | { kind: 'line'; start: ScenePoint; end: ScenePoint }
  | { kind: 'rectangle' | 'ellipse'; x: number; y: number; width: number; height: number }

const randomInt = () => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  return Math.floor(Math.random() * 0x7fffffff)
}
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function bump<T extends DrawingElementLike>(element: T, patch: Partial<T>): T {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  } as T
}

export function finalizeFreeDrawElement<T extends DrawingElementLike>(
  element: T,
  style: FinishedStrokeStyle,
): T {
  if (element.type !== 'freedraw' || element.isDeleted) return element
  const smoothing = clamp(style.smoothing / 100, 0, 1)
  return bump(element, {
    strokeColor: style.color,
    strokeWidth: clamp(style.width, 0.5, 32),
    strokeStyle: 'solid',
    roughness: 0,
    opacity: clamp(style.opacity, 5, 100),
    strokeOptions: {
      ...(element.strokeOptions ?? {}),
      variability: style.pressure ? 'variable' : 'constant',
      streamline: smoothing,
    },
    customData: {
      ...(element.customData ?? {}),
      canvasDrawing: {
        version: 1,
        kind: style.mode,
        smoothing: Math.round(clamp(style.smoothing, 0, 100)),
        pressure: style.pressure,
      },
    },
  } as unknown as Partial<T>)
}

export function strokePathLength(element: DrawingElementLike): number {
  if (element.type !== 'freedraw' || !element.points?.length) return 0
  let length = 0
  for (let i = 1; i < element.points.length; i++) {
    length += Math.hypot(element.points[i][0] - element.points[i - 1][0], element.points[i][1] - element.points[i - 1][1])
  }
  return length
}

export function isAccidentalTinyStroke(element: DrawingElementLike): boolean {
  if (element.type !== 'freedraw' || !element.points?.length) return false
  const diagonal = Math.hypot(element.width, element.height)
  return diagonal < 1.4 && strokePathLength(element) < 2.4
}

function scenePoint(element: DrawingElementLike, point: ScenePoint): ScenePoint {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const dx = point[0] - element.width / 2
  const dy = point[1] - element.height / 2
  const cosine = Math.cos(element.angle || 0)
  const sine = Math.sin(element.angle || 0)
  return [
    centerX + dx * cosine - dy * sine,
    centerY + dx * sine + dy * cosine,
  ]
}

function distancePointToSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const wx = point[0] - a[0]
  const wy = point[1] - a[1]
  const denominator = vx * vx + vy * vy
  if (denominator <= Number.EPSILON) return Math.hypot(wx, wy)
  const t = clamp((wx * vx + wy * vy) / denominator, 0, 1)
  return Math.hypot(point[0] - (a[0] + vx * t), point[1] - (a[1] + vy * t))
}

function distanceToPath(point: ScenePoint, path: readonly ScenePoint[]): number {
  if (!path.length) return Infinity
  if (path.length === 1) return Math.hypot(point[0] - path[0][0], point[1] - path[0][1])
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, distancePointToSegment(point, path[i - 1], path[i]))
  return best
}

function splitKeepRuns(flags: readonly boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let index = 0; index <= flags.length; index++) {
    const keep = index < flags.length && flags[index]
    if (keep && start < 0) start = index
    if (!keep && start >= 0) {
      if (index - start >= 2) runs.push([start, index])
      start = -1
    }
  }
  return runs
}

function rotatedCenter(element: DrawingElementLike, localCenter: ScenePoint): ScenePoint {
  const elementCenterLocal: ScenePoint = [element.width / 2, element.height / 2]
  const elementCenterScene: ScenePoint = [element.x + element.width / 2, element.y + element.height / 2]
  const dx = localCenter[0] - elementCenterLocal[0]
  const dy = localCenter[1] - elementCenterLocal[1]
  const cosine = Math.cos(element.angle || 0)
  const sine = Math.sin(element.angle || 0)
  return [
    elementCenterScene[0] + dx * cosine - dy * sine,
    elementCenterScene[1] + dx * sine + dy * cosine,
  ]
}

function cloneSegment<T extends DrawingElementLike>(
  element: T,
  start: number,
  end: number,
  index: string | null | undefined,
): T {
  const originalPoints = element.points ?? []
  const points = originalPoints.slice(start, end)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1])
  }
  const width = Math.max(0.0001, maxX - minX)
  const height = Math.max(0.0001, maxY - minY)
  const localCenter: ScenePoint = [(minX + maxX) / 2, (minY + maxY) / 2]
  const center = rotatedCenter(element, localCenter)
  const normalized = points.map(point => [point[0] - minX, point[1] - minY] as ScenePoint)
  const pressures = element.pressures?.length === originalPoints.length ? element.pressures.slice(start, end) : []
  return {
    ...element,
    id: randomId(),
    x: center[0] - width / 2,
    y: center[1] - height / 2,
    width,
    height,
    points: normalized,
    pressures,
    index,
    version: 1,
    versionNonce: randomInt(),
    seed: randomInt(),
    updated: Date.now(),
    isDeleted: false,
  } as T
}

export function eraseFreeDrawWithPath<T extends DrawingElementLike>(
  elements: readonly T[],
  path: readonly ScenePoint[],
  radius: number,
): { elements: T[]; affected: number } {
  if (!path.length) return { elements: [...elements], affected: 0 }
  const result: T[] = []
  let affected = 0
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
    const element = elements[elementIndex]
    if (element.type !== 'freedraw' || element.isDeleted || !element.points?.length) {
      result.push(element)
      continue
    }
    const threshold = Math.max(1, radius) + Math.max(0, Number(element.strokeWidth) || 0) / 2
    const keep = element.points.map(point => distanceToPath(scenePoint(element, point), path) > threshold)
    if (keep.every(Boolean)) {
      result.push(element)
      continue
    }
    affected++
    const runs = splitKeepRuns(keep)
    const tombstone = bump(element, { isDeleted: true } as unknown as Partial<T>)
    result.push(tombstone)
    if (!runs.length) continue
    const nextElement = elements.slice(elementIndex + 1).find(candidate => !candidate.isDeleted && candidate.index)
    let indices: string[]
    try {
      indices = generateNKeysBetween(element.index ?? null, nextElement?.index ?? null, runs.length)
    } catch {
      indices = generateNKeysBetween(element.index ?? null, null, runs.length)
    }
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const [start, end] = runs[runIndex]
      result.push(cloneSegment(element, start, end, indices[runIndex]))
    }
  }
  return { elements: result, affected }
}

function absoluteStrokePoints(element: DrawingElementLike): ScenePoint[] {
  return (element.points ?? []).map(point => scenePoint(element, point))
}

function boundsOf(points: readonly ScenePoint[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1])
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function recognizeHeldStroke(element: DrawingElementLike): CleanStrokeRecognition | null {
  if (element.type !== 'freedraw' || element.isDeleted || Math.abs(element.angle || 0) > 1e-4 || !element.points || element.points.length < 3) return null
  const points = absoluteStrokePoints(element)
  const bounds = boundsOf(points)
  const diagonal = Math.hypot(bounds.width, bounds.height)
  if (diagonal < 24) return null
  const start = points[0]
  const end = points.at(-1)!
  const endDistance = Math.hypot(end[0] - start[0], end[1] - start[1])
  const closed = endDistance <= Math.max(18, diagonal * 0.18)

  if (!closed && endDistance > 24) {
    let deviation = 0
    for (const point of points) deviation += distancePointToSegment(point, start, end)
    deviation /= points.length
    if (deviation <= Math.max(3.5, endDistance * 0.045)) return { kind: 'line', start, end }
  }

  if (!closed || bounds.width < 22 || bounds.height < 22) return null
  const minDimension = Math.max(1, Math.min(bounds.width, bounds.height))
  let rectangleScore = 0
  let ellipseScore = 0
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const radiusX = Math.max(1, bounds.width / 2)
  const radiusY = Math.max(1, bounds.height / 2)
  for (const point of points) {
    rectangleScore += Math.min(
      Math.abs(point[0] - bounds.minX),
      Math.abs(point[0] - bounds.maxX),
      Math.abs(point[1] - bounds.minY),
      Math.abs(point[1] - bounds.maxY),
    ) / minDimension
    const nx = (point[0] - centerX) / radiusX
    const ny = (point[1] - centerY) / radiusY
    ellipseScore += Math.abs(Math.hypot(nx, ny) - 1)
  }
  rectangleScore /= points.length
  ellipseScore /= points.length
  if (rectangleScore <= 0.10 && rectangleScore <= ellipseScore * 0.9) {
    return { kind: 'rectangle', x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height }
  }
  if (ellipseScore <= 0.20) {
    return { kind: 'ellipse', x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height }
  }
  return null
}
