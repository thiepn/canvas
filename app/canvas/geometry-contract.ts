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
