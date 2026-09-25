export const CANVAS_MAX_COORDINATE = 1_000_000_000
export const CANVAS_MAX_DIMENSION = 100_000_000
export const CANVAS_MAX_ANGLE = 1_000

export type CanvasGeometryLike = {
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  angle?: unknown
}

export type CanvasElementGeometryLike = CanvasGeometryLike & {
  type?: unknown
  points?: unknown
}

function finiteWithin(value: unknown, limit: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}

export function isSafeCanvasGeometry(value: CanvasGeometryLike): boolean {
  return finiteWithin(value.x, CANVAS_MAX_COORDINATE)
    && finiteWithin(value.y, CANVAS_MAX_COORDINATE)
    && finiteWithin(value.width, CANVAS_MAX_DIMENSION)
    && finiteWithin(value.height, CANVAS_MAX_DIMENSION)
    && finiteWithin(value.angle, CANVAS_MAX_ANGLE)
}


export const CANVAS_MAX_POINTS = 10_000

export function isSafeCanvasPoints(value: unknown, maxPoints = CANVAS_MAX_POINTS): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maxPoints
    && value.every(point =>
      Array.isArray(point)
      && point.length >= 2
      && finiteWithin(point[0], CANVAS_MAX_COORDINATE)
      && finiteWithin(point[1], CANVAS_MAX_COORDINATE),
    )
}


export function isSafeCanvasElementGeometry(value: CanvasElementGeometryLike): boolean {
  if (!isSafeCanvasGeometry(value)) return false
  return value.type === 'line' || value.type === 'arrow' || value.type === 'freedraw'
    ? isSafeCanvasPoints(value.points)
    : true
}
