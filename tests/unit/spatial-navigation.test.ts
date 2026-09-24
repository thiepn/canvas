import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assignElementsToFrame,
  fitFrameToContents,
  frameContents,
  renameFrame,
  richHtmlToPlainText,
  searchSpatialElements,
  setFrameContentsLocked,
  spatialBounds,
  viewportSceneBounds,
  type SpatialElementLike,
} from '../../app/canvas/spatial-navigation.ts'

const element = (id: string, type: string, x: number, y: number, width: number, height: number, patch: Partial<SpatialElementLike> = {}): SpatialElementLike => ({
  id, type, x, y, width, height, angle: 0, version: 1, versionNonce: 1, isDeleted: false, ...patch,
})

test('spatial bounds include rotation-aware extents', () => {
  const bounds = spatialBounds([
    element('a', 'rectangle', 0, 0, 100, 40, { angle: Math.PI / 2 }),
    element('b', 'rectangle', 200, 100, 20, 20),
  ])!
  assert.ok(bounds.minX < 30)
  assert.equal(bounds.maxX, 220)
  assert.equal(bounds.maxY, 120)
})

test('rich text HTML becomes searchable plain text', () => {
  assert.equal(richHtmlToPlainText('<p>Hello <strong>Canvas</strong></p><p>Second&nbsp;line</p>'), 'Hello Canvas\nSecond line')
})

test('search covers native text, rich text and named frames', () => {
  const elements = [
    element('text', 'text', 0, 0, 10, 10, { text: 'Alpha launch notes' }),
    element('rich', 'rectangle', 0, 0, 10, 10, { customData: { canvasRichText: { html: '<p>Beta canvas text</p>' } } }),
    element('frame', 'frame', 0, 0, 10, 10, { name: 'Research area' }),
  ]
  assert.deepEqual(searchSpatialElements(elements, 'canvas').map(result => result.id), ['rich'])
  assert.deepEqual(searchSpatialElements(elements, 'research').map(result => result.id), ['frame'])
})

test('frame auto-fit expands around contents without moving children', () => {
  const frame = element('frame', 'frame', 0, 0, 50, 50)
  const a = element('a', 'rectangle', 100, 120, 40, 20, { frameId: 'frame' })
  const b = element('b', 'ellipse', 180, 160, 20, 40, { frameId: 'frame' })
  const next = fitFrameToContents([frame, a, b], 'frame', 20)
  const fitted = next[0]
  assert.equal(fitted.x, 80)
  assert.equal(fitted.y, 100)
  assert.equal(fitted.width, 140)
  assert.equal(fitted.height, 120)
  assert.equal(next[1].x, 100)
  assert.equal(next[2].y, 160)
})

test('assigning selection to frame includes bound text', () => {
  const shape = element('shape', 'rectangle', 0, 0, 20, 20, { boundElements: [{ id: 'label', type: 'text' }] })
  const label = element('label', 'text', 0, 0, 10, 10)
  const other = element('other', 'rectangle', 30, 0, 10, 10)
  const next = assignElementsToFrame([shape, label, other], new Set(['shape']), 'frame')
  assert.equal(next[0].frameId, 'frame')
  assert.equal(next[1].frameId, 'frame')
  assert.equal(next[2].frameId, undefined)
})

test('frame lock and rename target contents/frame independently', () => {
  const frame = element('frame', 'frame', 0, 0, 100, 100, { name: 'Old' })
  const child = element('child', 'rectangle', 20, 20, 10, 10, { frameId: 'frame' })
  const locked = setFrameContentsLocked([frame, child], 'frame', true)
  assert.equal(locked[0].locked, undefined)
  assert.equal(locked[1].locked, true)
  const renamed = renameFrame(locked, 'frame', '  New   Area  ')
  assert.equal(renamed[0].name, 'New Area')
  assert.equal(frameContents(renamed, 'frame').length, 1)
})

test('viewport scene bounds reverse Excalidraw scroll transform', () => {
  const viewport = viewportSceneBounds({ scrollX: -100, scrollY: 50, zoom: { value: 2 }, width: 1000, height: 600 })
  assert.deepEqual(viewport, { minX: 100, minY: -50, maxX: 600, maxY: 250, width: 500, height: 300, midX: 350, midY: 100 })
})
