import assert from 'node:assert/strict'
import test from 'node:test'
import {
  eraseFreeDrawWithPath,
  finalizeFreeDrawElement,
  isAccidentalTinyStroke,
  recognizeHeldStroke,
  type DrawingElementLike,
} from '../../app/canvas/drawing-tools.ts'

type E = DrawingElementLike
const freedraw = (id: string, points: Array<readonly [number, number]>, patch: Partial<E> = {}): E => {
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  return {
    id,
    type: 'freedraw',
    x: 0,
    y: 0,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    angle: 0,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: 'a1',
    seed: 1,
    points,
    pressures: points.map(() => 0.5),
    simulatePressure: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    strokeOptions: { variability: 'variable', streamline: 0.2 },
    ...patch,
  }
}

test('completed pen style applies exact numeric width, smoothing and pressure mode', () => {
  const input = freedraw('a', [[0, 0], [10, 5], [20, 10]])
  const next = finalizeFreeDrawElement(input, { mode: 'pen', color: '#2563eb', width: 6, smoothing: 80, pressure: false, opacity: 100 })
  assert.equal(next.strokeColor, '#2563eb')
  assert.equal(next.strokeWidth, 6)
  assert.equal(next.strokeOptions?.streamline, 0.8)
  assert.equal(next.strokeOptions?.variability, 'constant')
  assert.deepEqual(next.customData?.canvasDrawing, { version: 1, kind: 'pen', smoothing: 80, pressure: false })
})

test('highlighter style persists translucent wide constant-width drawing metadata', () => {
  const input = freedraw('a', [[0, 0], [20, 0]])
  const next = finalizeFreeDrawElement(input, { mode: 'highlighter', color: '#ffd43b', width: 18, smoothing: 60, pressure: false, opacity: 32 })
  assert.equal(next.strokeWidth, 18)
  assert.equal(next.opacity, 32)
  assert.equal(next.strokeOptions?.variability, 'constant')
  assert.equal((next.customData?.canvasDrawing as Record<string, unknown>)?.kind, 'highlighter')
})

test('tiny accidental dots are rejected conservatively', () => {
  assert.equal(isAccidentalTinyStroke(freedraw('tiny', [[0, 0], [0.2, 0.2]], { width: 0.2, height: 0.2 })), true)
  assert.equal(isAccidentalTinyStroke(freedraw('real', [[0, 0], [2, 0], [4, 0]], { width: 4, height: 0 })), false)
})

test('partial eraser splits a freedraw stroke and preserves the surviving sides', () => {
  const input = freedraw('stroke', [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]], { width: 40, height: 0 })
  const result = eraseFreeDrawWithPath([input], [[20, -10], [20, 10]], 3)
  assert.equal(result.affected, 1)
  assert.equal(result.elements[0].isDeleted, true)
  const survivors = result.elements.filter(element => !element.isDeleted)
  assert.equal(survivors.length, 2)
  assert.ok(survivors.every(element => element.type === 'freedraw'))
  assert.ok(survivors.every(element => (element.points?.length ?? 0) >= 2))
})

test('partial eraser leaves untouched strokes byte-for-byte referenced', () => {
  const input = freedraw('stroke', [[0, 0], [10, 0], [20, 0]], { width: 20, height: 0 })
  const result = eraseFreeDrawWithPath([input], [[100, 100], [110, 100]], 5)
  assert.equal(result.affected, 0)
  assert.equal(result.elements[0], input)
})

test('hold recognition straightens an open near-linear stroke', () => {
  const line = freedraw('line', [[0, 0], [25, 1], [50, -1], [75, 1], [100, 0]], { width: 100, height: 2 })
  const recognition = recognizeHeldStroke(line)
  assert.equal(recognition?.kind, 'line')
})

test('hold recognition identifies a rough rectangle and ellipse', () => {
  const rectangle = freedraw('rect', [
    [0, 0], [30, 1], [60, 0], [100, 2], [99, 30], [100, 60], [70, 59], [35, 60], [0, 58], [1, 30], [0, 0],
  ], { width: 100, height: 60 })
  assert.equal(recognizeHeldStroke(rectangle)?.kind, 'rectangle')

  const ellipsePoints: Array<readonly [number, number]> = []
  for (let i = 0; i <= 24; i++) {
    const angle = i / 24 * Math.PI * 2
    ellipsePoints.push([50 + Math.cos(angle) * 50, 35 + Math.sin(angle) * 35])
  }
  const ellipse = freedraw('ellipse', ellipsePoints, { x: 0, y: 0, width: 100, height: 70 })
  assert.equal(recognizeHeldStroke(ellipse)?.kind, 'ellipse')
})
