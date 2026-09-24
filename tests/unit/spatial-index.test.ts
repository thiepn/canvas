import assert from 'node:assert/strict'
import test from 'node:test'
import { SpatialGridIndex, viewportBounds } from '../../app/canvas/spatial-index.ts'

type Element = {
  id: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  version: number
  versionNonce: number
  isDeleted: boolean
  type: string
}

const element = (id: string, x: number, y: number, patch: Partial<Element> = {}): Element => ({
  id, x, y, width: 80, height: 60, angle: 0, version: 1, versionNonce: 10, isDeleted: false, type: 'shape', ...patch,
})

test('spatial grid returns only viewport-intersecting elements in scene order', () => {
  const index = new SpatialGridIndex<Element>(100)
  index.sync([
    element('a', 0, 0),
    element('b', 500, 500),
    element('c', 50, 40),
  ])
  assert.deepEqual(index.query({ minX: -20, minY: -20, maxX: 160, maxY: 140 }).map(item => item.id), ['a', 'c'])
})

test('spatial grid updates changed stamps and removes tombstones or missing objects', () => {
  const index = new SpatialGridIndex<Element>(100)
  assert.deepEqual(index.sync([element('a', 0, 0), element('b', 300, 0)]), { scanned: 2, indexed: 2, changed: 2, removed: 0 })
  const second = index.sync([
    element('a', 600, 0, { version: 2, versionNonce: 20 }),
    element('b', 300, 0, { isDeleted: true, version: 2, versionNonce: 21 }),
  ])
  assert.equal(second.changed, 1)
  assert.equal(second.removed, 1)
  assert.deepEqual(index.query({ minX: 550, minY: -20, maxX: 720, maxY: 120 }).map(item => item.id), ['a'])
  assert.equal(index.get('b'), undefined)

  const third = index.sync([])
  assert.equal(third.removed, 1)
  assert.equal(index.size, 0)
})

test('rotated and very large elements remain queryable', () => {
  const index = new SpatialGridIndex<Element>(64)
  index.sync([
    element('rotated', 100, 100, { width: 120, height: 20, angle: Math.PI / 4 }),
    element('huge', -10000, -10000, { width: 20000, height: 20000 }),
  ])
  assert.deepEqual(new Set(index.query({ minX: 130, minY: 80, maxX: 190, maxY: 180 }).map(item => item.id)), new Set(['rotated', 'huge']))
})

test('unchanged immutable stamps avoid spatial recomputation while refreshing order', () => {
  const index = new SpatialGridIndex<Element>(100)
  const a = element('a', 0, 0)
  const b = element('b', 0, 0)
  index.sync([a, b])
  const stats = index.sync([{ ...b }, { ...a }])
  assert.equal(stats.changed, 0)
  assert.deepEqual(index.query({ minX: -10, minY: -10, maxX: 100, maxY: 100 }).map(item => item.id), ['b', 'a'])
})

test('viewport bounds convert screen overscan into scene coordinates', () => {
  assert.deepEqual(
    viewportBounds({ scrollX: -100, scrollY: -50, zoom: { value: 2 }, width: 800, height: 600 }, 200),
    { minX: 0, minY: -50, maxX: 600, maxY: 450 },
  )
})
