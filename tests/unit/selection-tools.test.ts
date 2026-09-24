import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alignSelection,
  bindConnectorEndpoint,
  commonBounds,
  copyVisualStyle,
  detachConnectorEndpoint,
  distributeSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  pasteVisualStyle,
  reorderSelection,
  reverseConnector,
  resizeSelection,
  rotateSelection,
  selectFrameContents,
  selectSame,
  setConnectorArrowheads,
  setConnectorBend,
  setConnectorRouting,
  setSelectionPosition,
  toggleLockSelection,
  ungroupSelection,
  type CanvasElementLike,
} from '../../app/canvas/selection-tools.ts'

type E = CanvasElementLike & { label?: string }
const element = (id: string, x: number, y: number, width = 20, height = 20, patch: Partial<E> = {}): E => ({
  id, type: 'rectangle', x, y, width, height, angle: 0, version: 1, versionNonce: 1,
  isDeleted: false, groupIds: [], locked: false, index: `a${id}`, strokeColor: '#000000',
  backgroundColor: 'transparent', ...patch,
})

test('group and ungroup preserve nested group ordering', () => {
  const a = element('1', 0, 0, 20, 20, { groupIds: ['inner'] })
  const b = element('2', 30, 0, 20, 20, { groupIds: ['inner'] })
  const grouped = groupSelection([a, b], new Set(['1', '2']), 'outer')
  assert.deepEqual(grouped.elements.map(e => e.groupIds), [['inner', 'outer'], ['inner', 'outer']])
  const ungrouped = ungroupSelection(grouped.elements, new Set(['1', '2']), new Set(['outer']))
  assert.deepEqual(ungrouped.elements.map(e => e.groupIds), [['inner'], ['inner']])
})

test('alignment treats an outer group as one selection unit', () => {
  const a = element('1', 0, 0, 10, 10, { groupIds: ['g'] })
  const b = element('2', 20, 0, 10, 10, { groupIds: ['g'] })
  const c = element('3', 100, 50, 10, 10)
  const next = alignSelection([a, b, c], new Set(['1', '2', '3']), 'bottom')
  assert.equal(next[0].y, 50)
  assert.equal(next[1].y, 50)
  assert.equal(next[2].y, 50)
})

test('distribution spaces three units evenly', () => {
  const next = distributeSelection([
    element('1', 0, 0, 10, 10),
    element('2', 40, 0, 10, 10),
    element('3', 100, 0, 10, 10),
  ], new Set(['1', '2', '3']), 'x')
  assert.equal(next[0].x, 0)
  assert.equal(next[1].x, 50)
  assert.equal(next[2].x, 100)
})

test('z-order actions preserve selected relative order and reindex moved elements', () => {
  const elements = [element('1', 0, 0), element('2', 0, 0), element('3', 0, 0), element('4', 0, 0)]
  const front = reorderSelection(elements, new Set(['2', '3']), 'front')
  assert.deepEqual(front.map(e => e.id), ['1', '4', '2', '3'])
  assert.notEqual(front[2].index, elements[1].index)
  const backward = reorderSelection(elements, new Set(['3']), 'backward')
  assert.deepEqual(backward.map(e => e.id), ['1', '3', '2', '4'])
})

test('duplicate remaps internal ids, groups and bindings', () => {
  const a = element('1', 0, 0, 20, 20, { groupIds: ['g'], boundElements: [{ id: '2', type: 'text' }] })
  const b = element('2', 5, 5, 10, 10, { type: 'text', groupIds: ['g'], containerId: '1' })
  const result = duplicateSelection([a, b], new Set(['1', '2']))
  assert.equal(result.elements.length, 4)
  const [ca, cb] = result.elements.slice(2)
  assert.notEqual(ca.id, a.id)
  assert.equal(cb.containerId, ca.id)
  assert.equal(ca.boundElements?.[0]?.id, cb.id)
  assert.equal(ca.groupIds?.[0], cb.groupIds?.[0])
  assert.equal(ca.x, 16)
})

test('position, resize and rotation transform the whole selection', () => {
  const input = [element('1', 10, 20, 20, 20), element('2', 50, 20, 20, 20)]
  const moved = setSelectionPosition(input, new Set(['1', '2']), 0, 0)
  assert.equal(commonBounds(moved)?.minX, 0)
  assert.equal(commonBounds(moved)?.minY, 0)
  const resized = resizeSelection(moved, new Set(['1', '2']), 140, 40)
  assert.equal(Math.round(commonBounds(resized)!.width), 140)
  assert.equal(Math.round(commonBounds(resized)!.height), 40)
  const rotated = rotateSelection(resized, new Set(['1', '2']), 90)
  assert.ok(Math.abs(rotated[0].angle - Math.PI / 2) < 1e-8)
})

test('flip mirrors centers and lock toggles selection', () => {
  const input = [element('1', 0, 0, 10, 10), element('2', 30, 0, 10, 10)]
  const flipped = flipSelection(input, new Set(['1', '2']), 'x')
  assert.equal(Math.round(flipped[0].x), 30)
  assert.equal(Math.round(flipped[1].x), 0)
  const locked = toggleLockSelection(flipped, new Set(['1', '2']))
  assert.equal(locked.locked, true)
  assert.ok(locked.elements.every(e => e.locked))
})

test('select same can match type, stroke or fill', () => {
  const input = [
    element('1', 0, 0, 10, 10, { type: 'ellipse', strokeColor: '#f00', backgroundColor: '#fff' }),
    element('2', 20, 0, 10, 10, { type: 'ellipse', strokeColor: '#00f', backgroundColor: '#fff' }),
    element('3', 40, 0, 10, 10, { type: 'rectangle', strokeColor: '#f00', backgroundColor: '#000' }),
  ]
  assert.deepEqual(Object.keys(selectSame(input, new Set(['1']), 'type')), ['1', '2'])
  assert.deepEqual(Object.keys(selectSame(input, new Set(['1']), 'stroke')), ['1', '3'])
  assert.deepEqual(Object.keys(selectSame(input, new Set(['1']), 'fill')), ['1', '2'])
})


test('visual style copy and paste transfers drawing properties without geometry', () => {
  const source = element('1', 10, 10, 30, 20, {
    strokeColor: '#ff0000',
    backgroundColor: '#ffeeaa',
    fillStyle: 'hachure',
    strokeWidth: 4,
    strokeStyle: 'dashed',
    roughness: 2,
    opacity: 65,
  })
  const target = element('2', 200, 100, 50, 40, {
    strokeColor: '#0000ff',
    backgroundColor: 'transparent',
  })
  const style = copyVisualStyle(source)
  const next = pasteVisualStyle([source, target], new Set(['2']), style)
  assert.equal(next[1].strokeColor, '#ff0000')
  assert.equal(next[1].backgroundColor, '#ffeeaa')
  assert.equal(next[1].strokeWidth, 4)
  assert.equal(next[1].x, 200)
  assert.equal(next[1].width, 50)
})


test('select frame contents selects unlocked active children only', () => {
  const input = [
    element('frame', 0, 0, 100, 100, { type: 'frame' }),
    element('1', 10, 10, 10, 10, { frameId: 'frame' }),
    element('2', 20, 20, 10, 10, { frameId: 'frame', locked: true }),
    element('3', 30, 30, 10, 10, { frameId: 'other' }),
  ]
  assert.deepEqual(Object.keys(selectFrameContents(input, 'frame')), ['1'])
})


test('grouping non-contiguous layers makes the group contiguous at the highest selected layer', () => {
  const input = [
    element('1', 0, 0),
    element('2', 20, 0),
    element('3', 40, 0),
    element('4', 60, 0),
  ]
  const result = groupSelection(input, new Set(['1', '3']), 'g')
  assert.deepEqual(result.elements.map(element => element.id), ['2', '1', '3', '4'])
  assert.deepEqual(result.elements.filter(element => element.groupIds?.includes('g')).map(element => element.id), ['1', '3'])
})

test('grouping elements from different frames detaches them from frame membership', () => {
  const input = [
    element('1', 0, 0, 10, 10, { frameId: 'frame-a' }),
    element('2', 20, 0, 10, 10, { frameId: 'frame-b' }),
  ]
  const result = groupSelection(input, new Set(['1', '2']), 'g')
  assert.ok(result.elements.every(element => element.frameId === null))
})


test('alignment keeps a selected bound label with its container', () => {
  const container = element('box', 30, 20, 60, 40, { boundElements: [{ id: 'label', type: 'text' }] })
  const label = element('label', 45, 30, 30, 20, { type: 'text', containerId: 'box' })
  const other = element('other', 200, 100, 40, 40)
  const next = alignSelection([container, label, other], new Set(['box', 'label', 'other']), 'top')
  assert.equal(next[0].y, 20)
  assert.equal(next[1].y, 30)
  assert.equal(next[2].y, 20)
})

test('pasting arrow style onto a rectangle does not add arrowheads', () => {
  const source = element('arrow', 0, 0, 20, 20, { type: 'arrow', startArrowhead: 'dot', endArrowhead: 'arrow' })
  const target = element('rect', 40, 0)
  const next = pasteVisualStyle([source, target], new Set(['rect']), copyVisualStyle(source))
  assert.equal(next[1].startArrowhead, undefined)
  assert.equal(next[1].endArrowhead, undefined)
})


test('selected frame and its children align as one spatial unit', () => {
  const frame = element('frame', 0, 20, 100, 80, { type: 'frame' })
  const child = element('child', 20, 40, 20, 20, { frameId: 'frame' })
  const other = element('other', 200, 120, 20, 20)
  const next = alignSelection([frame, child, other], new Set(['frame', 'child', 'other']), 'bottom')
  assert.equal(next[0].y, 60)
  assert.equal(next[1].y, 80)
  assert.equal(next[2].y, 120)
  assert.equal(next[1].y - next[0].y, child.y - frame.y)
})

test('resizing uses element centers so rotated selections do not drift from scaling geometry', () => {
  const rotated = element('1', 20, 20, 40, 20, { angle: Math.PI / 4 })
  const other = element('2', 100, 20, 20, 20)
  const before = commonBounds([rotated, other])!
  const next = resizeSelection([rotated, other], new Set(['1', '2']), before.width * 2, before.height * 2)
  const after = commonBounds(next)!
  assert.ok(Math.abs(after.midX - before.midX * 2 + before.minX) < after.width)
  assert.ok(after.width > before.width)
})


test('custom Canvas shape logical type does not collapse into rectangles', () => {
  const triangle = element('triangle', 0, 0, 20, 20, { customData: { canvasShape: { version: 1, kind: 'triangle' } } })
  const triangle2 = element('triangle2', 30, 0, 20, 20, { customData: { canvasShape: { version: 1, kind: 'triangle' } } })
  const star = element('star', 60, 0, 20, 20, { customData: { canvasShape: { version: 1, kind: 'star' } } })
  const rect = element('rect', 90, 0)
  assert.deepEqual(Object.keys(selectSame([triangle, triangle2, star, rect], new Set(['triangle']), 'type')), ['triangle', 'triangle2'])
})

test('connector routing and arrowhead presets update only arrows', () => {
  const arrow = element('arrow', 0, 0, 100, 0, { type: 'arrow', points: [[0, 0], [100, 0]], startArrowhead: null, endArrowhead: 'arrow', elbowed: false })
  const rect = element('rect', 120, 0)
  const curved = setConnectorRouting([arrow, rect], new Set(['arrow']), 'curved')
  assert.deepEqual(curved[0].roundness, { type: 2 })
  assert.equal(curved[0].elbowed, false)
  const elbow = setConnectorRouting(curved, new Set(['arrow']), 'elbow')
  assert.equal(elbow[0].elbowed, true)
  const heads = setConnectorArrowheads(elbow, new Set(['arrow']), 'circle', 'triangle')
  assert.equal(heads[0].startArrowhead, 'circle')
  assert.equal(heads[0].endArrowhead, 'triangle')
  assert.equal(heads[1].startArrowhead, undefined)
})

test('connector binding updates reciprocal bound-element records and detach removes them', () => {
  const arrow = element('arrow', 0, 0, 100, 0, { type: 'arrow', startBinding: null, endBinding: null, boundElements: null })
  const left = element('left', -40, -20, 30, 30)
  const right = element('right', 120, -20, 30, 30)
  const boundStart = bindConnectorEndpoint([arrow, left, right], 'arrow', 'left', 'start')
  const boundBoth = bindConnectorEndpoint(boundStart, 'arrow', 'right', 'end')
  const connector = boundBoth.find(item => item.id === 'arrow')!
  assert.equal(connector.startBinding?.elementId, 'left')
  assert.equal(connector.endBinding?.elementId, 'right')
  assert.deepEqual(boundBoth.find(item => item.id === 'left')!.boundElements, [{ id: 'arrow', type: 'arrow' }])
  assert.deepEqual(boundBoth.find(item => item.id === 'right')!.boundElements, [{ id: 'arrow', type: 'arrow' }])
  const detached = detachConnectorEndpoint(boundBoth, 'arrow', 'start')
  assert.equal(detached.find(item => item.id === 'arrow')!.startBinding, null)
  assert.deepEqual(detached.find(item => item.id === 'left')!.boundElements, [])
})

test('reverse connector swaps endpoints and bindings without moving geometry', () => {
  const arrow = element('arrow', 10, 10, 100, 30, {
    type: 'arrow',
    startArrowhead: null,
    endArrowhead: 'triangle',
    startBinding: { elementId: 'a' },
    endBinding: { elementId: 'b' },
  })
  const [next] = reverseConnector([arrow], 'arrow')
  assert.equal(next.startArrowhead, 'triangle')
  assert.equal(next.endArrowhead, null)
  assert.equal(next.startBinding?.elementId, 'b')
  assert.equal(next.endBinding?.elementId, 'a')
  assert.equal(next.x, 10)
  assert.equal(next.y, 10)
})


test('connector bend continuously reshapes a curved connector while preserving endpoints', () => {
  const arrow = element('arrow', 0, 0, 100, 0, {
    type: 'arrow',
    points: [[0, 0], [100, 0]],
    startArrowhead: null,
    endArrowhead: 'arrow',
  })
  const [positive] = setConnectorBend([arrow], new Set(['arrow']), 50)
  assert.equal(positive.points?.length, 3)
  assert.deepEqual(positive.points?.[0], [0, 0])
  assert.deepEqual(positive.points?.at(-1), [100, 0])
  assert.ok(Number(positive.points?.[1]?.[1]) > 0)
  const [negative] = setConnectorBend([positive], new Set(['arrow']), -50)
  assert.ok(Number(negative.points?.[1]?.[1]) < 0)
  assert.equal((negative.customData?.canvasConnector as Record<string, unknown>)?.bend, -50)
})
