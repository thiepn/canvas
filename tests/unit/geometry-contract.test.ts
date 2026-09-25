import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANVAS_MAX_ANGLE,
  CANVAS_MAX_COORDINATE,
  CANVAS_MAX_DIMENSION,
  isSafeCanvasGeometry,
  isSafeCanvasPoints,
} from '../../app/canvas/geometry-contract.ts'

test('Canvas geometry accepts normal and boundary-safe scene values', () => {
  assert.equal(isSafeCanvasGeometry({ x: 10, y: -20, width: 100, height: 80, angle: 0 }), true)
  assert.equal(isSafeCanvasGeometry({
    x: CANVAS_MAX_COORDINATE,
    y: -CANVAS_MAX_COORDINATE,
    width: CANVAS_MAX_DIMENSION,
    height: -CANVAS_MAX_DIMENSION,
    angle: CANVAS_MAX_ANGLE,
  }), true)
})

test('Canvas geometry rejects non-finite, missing and pathological values', () => {
  assert.equal(isSafeCanvasGeometry({ x: Infinity, y: 0, width: 1, height: 1, angle: 0 }), false)
  assert.equal(isSafeCanvasGeometry({ x: 0, y: 0, width: CANVAS_MAX_DIMENSION + 1, height: 1, angle: 0 }), false)
  assert.equal(isSafeCanvasGeometry({ x: 0, y: 0, width: 1, height: 1, angle: CANVAS_MAX_ANGLE + 1 }), false)
  assert.equal(isSafeCanvasGeometry({ x: 0, y: 0, width: 1, height: 1 }), false)
  assert.equal(isSafeCanvasGeometry({ x: '0', y: 0, width: 1, height: 1, angle: 0 }), false)
})


test('Canvas point arrays are bounded in length and coordinates', () => {
  assert.equal(isSafeCanvasPoints([[0, 0], [10, -20]]), true)
  assert.equal(isSafeCanvasPoints([]), false)
  assert.equal(isSafeCanvasPoints([[0, Infinity]]), false)
  assert.equal(isSafeCanvasPoints([[CANVAS_MAX_COORDINATE + 1, 0]]), false)
  assert.equal(isSafeCanvasPoints(Array.from({ length: 10_001 }, () => [0, 0])), false)
})
