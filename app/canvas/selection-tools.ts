import { generateNKeysBetween } from 'fractional-indexing'

export type CanvasPoint = readonly [number, number]
export type CanvasBinding = { elementId: string; [key: string]: unknown }
export type CanvasBoundElement = { id: string; type: string }

export type CanvasElementLike = {
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
  groupIds?: readonly string[]
  locked?: boolean
  frameId?: string | null
  points?: readonly CanvasPoint[]
  fontSize?: number
  seed?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: string
  roughness?: number
  opacity?: number
  roundness?: unknown
  startArrowhead?: unknown
  endArrowhead?: unknown
  elbowed?: boolean
  fixedSegments?: unknown
  containerId?: string | null
  boundElements?: readonly CanvasBoundElement[] | null
  startBinding?: CanvasBinding | null
  endBinding?: CanvasBinding | null
  customData?: Record<string, unknown>
  [key: string]: unknown
}

export type SelectionBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  midX: number
  midY: number
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
export type DistributeAxis = 'x' | 'y'
export type ZOrderAction = 'backward' | 'forward' | 'back' | 'front'
export type SameSelectionMode = 'type' | 'stroke' | 'fill'
export type ConnectorRouting = 'straight' | 'curved' | 'elbow'
export type ConnectorArrowhead =
  | 'arrow'
  | 'bar'
  | 'circle'
  | 'circle_outline'
  | 'triangle'
  | 'triangle_outline'
  | 'diamond'
  | 'diamond_outline'
  | null

export type VisualStyle = Pick<CanvasElementLike,
  'strokeColor' | 'backgroundColor' | 'fillStyle' | 'strokeWidth' | 'strokeStyle' |
  'roughness' | 'opacity' | 'roundness' | 'startArrowhead' | 'endArrowhead'
>

const TAU = Math.PI * 2
const randomInt = () => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  return Math.floor(Math.random() * 0x7fffffff)
}
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`

function normalizedAngle(angle: number): number {
  const next = angle % TAU
  return next < 0 ? next + TAU : next
}

function bump<T extends CanvasElementLike>(element: T, patch: Partial<T>): T {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  } as T
}

function activeSelected<T extends CanvasElementLike>(elements: readonly T[], selectedIds: ReadonlySet<string>): T[] {
  return elements.filter(element => !element.isDeleted && selectedIds.has(element.id))
}

export function elementBounds(element: CanvasElementLike): SelectionBounds {
  const width = Math.abs(element.width)
  const height = Math.abs(element.height)
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const cosine = Math.abs(Math.cos(element.angle || 0))
  const sine = Math.abs(Math.sin(element.angle || 0))
  const extentX = (width * cosine + height * sine) / 2
  const extentY = (width * sine + height * cosine) / 2
  const minX = cx - extentX
  const maxX = cx + extentX
  const minY = cy - extentY
  const maxY = cy + extentY
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, midX: cx, midY: cy }
}

export function commonBounds(elements: readonly CanvasElementLike[]): SelectionBounds | null {
  if (!elements.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const element of elements) {
    const bounds = elementBounds(element)
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2 }
}

function unitKey(element: CanvasElementLike): string {
  const groups = element.groupIds ?? []
  return groups.length ? `group:${groups[groups.length - 1]}` : `element:${element.id}`
}

function selectionUnits<T extends CanvasElementLike>(elements: readonly T[]): T[][] {
  const selectedIds = new Set(elements.map(element => element.id))
  const selectedFrames = new Set(elements.filter(element => element.type === 'frame').map(element => element.id))
  const boundToContainer = new Map<string, string>()
  const containersWithBoundText = new Set<string>()
  for (const element of elements) {
    for (const binding of element.boundElements ?? []) {
      if (binding.type === 'text' && selectedIds.has(binding.id)) {
        boundToContainer.set(binding.id, element.id)
        containersWithBoundText.add(element.id)
      }
    }
  }
  const units = new Map<string, T[]>()
  for (const element of elements) {
    const frameKey = element.type === 'frame'
      ? `frame:${element.id}`
      : element.frameId && selectedFrames.has(element.frameId)
        ? `frame:${element.frameId}`
        : null
    const containerId = element.containerId && selectedIds.has(element.containerId)
      ? element.containerId
      : boundToContainer.get(element.id)
    const key = frameKey
      ?? (containerId
        ? `container:${containerId}`
        : containersWithBoundText.has(element.id)
          ? `container:${element.id}`
          : unitKey(element))
    const current = units.get(key)
    if (current) current.push(element)
    else units.set(key, [element])
  }
  return [...units.values()]
}

function translateIds<T extends CanvasElementLike>(elements: readonly T[], ids: ReadonlySet<string>, dx: number, dy: number): T[] {
  if (!dx && !dy) return [...elements]
  return elements.map(element => ids.has(element.id) && !element.isDeleted
    ? bump(element, { x: element.x + dx, y: element.y + dy } as Partial<T>)
    : element)
}

export function groupSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  groupId = randomId(),
): { elements: T[]; groupId: string; selectedIds: Record<string, true>; selectedGroupIds: Record<string, true> } {
  const selected = activeSelected(elements, selectedIds)
  if (selected.length < 2) return { elements: [...elements], groupId, selectedIds: Object.fromEntries(selected.map(e => [e.id, true])), selectedGroupIds: {} }
  const selectedMap = new Set(selected.map(element => element.id))
  const frameIds = new Set(selected.map(element => element.frameId ?? null))
  const detachFromFrames = frameIds.size > 1
  const next = elements.map(element => {
    if (!selectedMap.has(element.id)) return element
    const groupIds = [...(element.groupIds ?? [])]
    if (!groupIds.includes(groupId)) groupIds.push(groupId)
    return bump(element, {
      groupIds,
      ...(detachFromFrames ? { frameId: null } : {}),
    } as unknown as Partial<T>)
  })
  const highestSelectedIndex = Math.max(...elements.map((element, index) => selectedMap.has(element.id) ? index : -1))
  const groupedElements = next.filter(element => selectedMap.has(element.id))
  const before = next.slice(0, highestSelectedIndex + 1).filter(element => !selectedMap.has(element.id))
  const after = next.slice(highestSelectedIndex + 1).filter(element => !selectedMap.has(element.id))
  const contiguous = reindexMoved([...before, ...groupedElements, ...after], selectedMap)
  return {
    elements: contiguous,
    groupId,
    selectedIds: Object.fromEntries(selected.map(element => [element.id, true])),
    selectedGroupIds: { [groupId]: true },
  }
}

export function ungroupSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  selectedGroupIds: ReadonlySet<string>,
): { elements: T[]; removedGroupIds: string[] } {
  const selected = activeSelected(elements, selectedIds)
  const target = new Set(selectedGroupIds)
  if (!target.size && selected.length) {
    const groupCounts = new Map<string, number>()
    for (const element of selected) {
      const groups = element.groupIds ?? []
      const outer = groups.at(-1)
      if (outer) groupCounts.set(outer, (groupCounts.get(outer) ?? 0) + 1)
    }
    for (const [groupId, count] of groupCounts) if (count === selected.length) target.add(groupId)
  }
  if (!target.size) return { elements: [...elements], removedGroupIds: [] }
  const next = elements.map(element => {
    const groups = element.groupIds ?? []
    const filtered = groups.filter(groupId => !target.has(groupId))
    return filtered.length === groups.length ? element : bump(element, { groupIds: filtered } as unknown as Partial<T>)
  })
  return { elements: next, removedGroupIds: [...target] }
}

export function toggleLockSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
): { elements: T[]; locked: boolean } {
  const selected = activeSelected(elements, selectedIds)
  const locked = selected.every(element => !element.locked)
  return {
    locked,
    elements: elements.map(element => selectedIds.has(element.id) && !element.isDeleted
      ? bump(element, { locked } as Partial<T>)
      : element),
  }
}

export function unlockAll<T extends CanvasElementLike>(elements: readonly T[]): { elements: T[]; selectedIds: Record<string, true> } {
  const locked = elements.filter(element => !element.isDeleted && element.locked)
  return {
    elements: elements.map(element => element.locked ? bump(element, { locked: false } as Partial<T>) : element),
    selectedIds: Object.fromEntries(locked.map(element => [element.id, true])),
  }
}

export function alignSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  mode: AlignMode,
): T[] {
  const selected = activeSelected(elements, selectedIds)
  if (selected.length < 2) return [...elements]
  const selection = commonBounds(selected)
  if (!selection) return [...elements]
  const translations = new Map<string, { dx: number; dy: number }>()
  for (const unit of selectionUnits(selected)) {
    const box = commonBounds(unit)!
    let dx = 0, dy = 0
    if (mode === 'left') dx = selection.minX - box.minX
    if (mode === 'centerX') dx = selection.midX - box.midX
    if (mode === 'right') dx = selection.maxX - box.maxX
    if (mode === 'top') dy = selection.minY - box.minY
    if (mode === 'centerY') dy = selection.midY - box.midY
    if (mode === 'bottom') dy = selection.maxY - box.maxY
    for (const element of unit) translations.set(element.id, { dx, dy })
  }
  return elements.map(element => {
    const translation = translations.get(element.id)
    return translation ? bump(element, { x: element.x + translation.dx, y: element.y + translation.dy } as Partial<T>) : element
  })
}

export function distributeSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  axis: DistributeAxis,
): T[] {
  const selected = activeSelected(elements, selectedIds)
  const units = selectionUnits(selected).map(unit => ({ unit, box: commonBounds(unit)! }))
  if (units.length < 3) return [...elements]
  const selection = commonBounds(selected)!
  const start = axis === 'x' ? 'minX' : 'minY'
  const mid = axis === 'x' ? 'midX' : 'midY'
  const extent = axis === 'x' ? 'width' : 'height'
  units.sort((a, b) => a.box[mid] - b.box[mid])
  const span = units.reduce((sum, item) => sum + item.box[extent], 0)
  const available = selection[extent] - span
  const translations = new Map<string, { dx: number; dy: number }>()

  if (available >= 0) {
    const gap = available / (units.length - 1)
    let position = selection[start]
    for (const item of units) {
      const delta = position - item.box[start]
      for (const element of item.unit) translations.set(element.id, axis === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta })
      position += item.box[extent] + gap
    }
  } else {
    const first = units[0].box[mid]
    const last = units.at(-1)!.box[mid]
    const step = (last - first) / (units.length - 1)
    for (let i = 1; i < units.length - 1; i++) {
      const delta = first + step * i - units[i].box[mid]
      for (const element of units[i].unit) translations.set(element.id, axis === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta })
    }
  }

  return elements.map(element => {
    const translation = translations.get(element.id)
    return translation ? bump(element, { x: element.x + translation.dx, y: element.y + translation.dy } as Partial<T>) : element
  })
}

function reindexMoved<T extends CanvasElementLike>(elements: readonly T[], movedIds: ReadonlySet<string>): T[] {
  const next = [...elements]
  let index = 0
  while (index < next.length) {
    if (!movedIds.has(next[index].id)) { index++; continue }
    const start = index
    while (index < next.length && movedIds.has(next[index].id)) index++
    const end = index
    const lower = start > 0 ? next[start - 1].index ?? null : null
    const upper = end < next.length ? next[end].index ?? null : null
    let keys: string[]
    try {
      keys = generateNKeysBetween(lower, upper, end - start)
    } catch {
      const allKeys = generateNKeysBetween(null, null, next.length)
      return next.map((element, itemIndex) => element.index === allKeys[itemIndex]
        ? element
        : bump(element, { index: allKeys[itemIndex] } as Partial<T>))
    }
    for (let i = start; i < end; i++) next[i] = bump(next[i], { index: keys[i - start] } as Partial<T>)
  }
  return next
}

export function reorderSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  action: ZOrderAction,
): T[] {
  const moved = new Set(activeSelected(elements, selectedIds).map(element => element.id))
  if (!moved.size) return [...elements]
  let ordered = [...elements]
  if (action === 'back') ordered = [...ordered.filter(element => moved.has(element.id)), ...ordered.filter(element => !moved.has(element.id))]
  if (action === 'front') ordered = [...ordered.filter(element => !moved.has(element.id)), ...ordered.filter(element => moved.has(element.id))]
  if (action === 'backward') {
    for (let i = 1; i < ordered.length; i++) {
      if (moved.has(ordered[i].id) && !moved.has(ordered[i - 1].id)) [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]]
    }
  }
  if (action === 'forward') {
    for (let i = ordered.length - 2; i >= 0; i--) {
      if (moved.has(ordered[i].id) && !moved.has(ordered[i + 1].id)) [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]]
    }
  }
  return reindexMoved(ordered, moved)
}

function remapBinding(binding: CanvasBinding | null | undefined, ids: Map<string, string>): CanvasBinding | null | undefined {
  if (!binding) return binding
  const mapped = ids.get(binding.elementId)
  return mapped ? { ...binding, elementId: mapped } : null
}

export function duplicateSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  offset = 16,
): { elements: T[]; duplicatedIds: Record<string, true> } {
  const selected = activeSelected(elements, selectedIds)
  if (!selected.length) return { elements: [...elements], duplicatedIds: {} }
  const ids = new Map(selected.map(element => [element.id, randomId()]))
  const groupIds = new Map<string, string>()
  for (const element of selected) for (const groupId of element.groupIds ?? []) if (!groupIds.has(groupId)) groupIds.set(groupId, randomId())
  const lastIndex = [...elements].reverse().find(element => element.index)?.index ?? null
  const indices = generateNKeysBetween(lastIndex, null, selected.length)

  const clones = selected.map((element, index) => {
    const id = ids.get(element.id)!
    const clone = {
      ...element,
      id,
      x: element.x + offset,
      y: element.y + offset,
      index: indices[index],
      version: 1,
      versionNonce: randomInt(),
      seed: randomInt(),
      updated: Date.now(),
      locked: false,
      groupIds: (element.groupIds ?? []).map(groupId => groupIds.get(groupId) ?? groupId),
      frameId: element.frameId ? ids.get(element.frameId) ?? element.frameId : element.frameId,
      containerId: element.containerId ? ids.get(element.containerId) ?? null : element.containerId,
      boundElements: element.boundElements?.map(binding => ids.has(binding.id) ? { ...binding, id: ids.get(binding.id)! } : null).filter(Boolean) as CanvasBoundElement[] | null | undefined,
      startBinding: remapBinding(element.startBinding, ids),
      endBinding: remapBinding(element.endBinding, ids),
    } as T
    return clone
  })
  return { elements: [...elements, ...clones], duplicatedIds: Object.fromEntries(clones.map(element => [element.id, true])) }
}

export function nudgeSelection<T extends CanvasElementLike>(elements: readonly T[], selectedIds: ReadonlySet<string>, dx: number, dy: number): T[] {
  return translateIds(elements, selectedIds, dx, dy)
}

function scalePoint(point: CanvasPoint, sx: number, sy: number): CanvasPoint {
  return [point[0] * sx, point[1] * sy]
}

export function resizeSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  targetWidth: number | null,
  targetHeight: number | null,
): T[] {
  const selected = activeSelected(elements, selectedIds)
  const bounds = commonBounds(selected)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [...elements]
  const sx = targetWidth !== null && Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth / bounds.width : 1
  const sy = targetHeight !== null && Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight / bounds.height : 1
  return elements.map(element => {
    if (!selectedIds.has(element.id) || element.isDeleted) return element
    const nextWidth = element.width * sx
    const nextHeight = element.height * sy
    const centerX = element.x + element.width / 2
    const centerY = element.y + element.height / 2
    const nextCenterX = bounds.minX + (centerX - bounds.minX) * sx
    const nextCenterY = bounds.minY + (centerY - bounds.minY) * sy
    const patch: Partial<T> = {
      x: nextCenterX - nextWidth / 2,
      y: nextCenterY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    } as Partial<T>
    if (element.points) (patch as CanvasElementLike).points = element.points.map(point => scalePoint(point, sx, sy))
    if (element.type === 'text' && typeof element.fontSize === 'number') (patch as CanvasElementLike).fontSize = Math.max(1, element.fontSize * Math.min(Math.abs(sx), Math.abs(sy)))
    return bump(element, patch)
  })
}

export function setSelectionPosition<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  x: number | null,
  y: number | null,
): T[] {
  const selected = activeSelected(elements, selectedIds)
  const bounds = commonBounds(selected)
  if (!bounds) return [...elements]
  const dx = x !== null && Number.isFinite(x) ? x - bounds.minX : 0
  const dy = y !== null && Number.isFinite(y) ? y - bounds.minY : 0
  return translateIds(elements, selectedIds, dx, dy)
}

export function rotateSelection<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  degrees: number,
  absoluteForSingle = true,
): T[] {
  const selected = activeSelected(elements, selectedIds)
  if (!selected.length || !Number.isFinite(degrees)) return [...elements]
  if (selected.length === 1 && absoluteForSingle) {
    const target = normalizedAngle(degrees * Math.PI / 180)
    return elements.map(element => element.id === selected[0].id ? bump(element, { angle: target } as Partial<T>) : element)
  }
  const bounds = commonBounds(selected)!
  const delta = degrees * Math.PI / 180
  const cosine = Math.cos(delta), sine = Math.sin(delta)
  return elements.map(element => {
    if (!selectedIds.has(element.id) || element.isDeleted) return element
    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    const rx = bounds.midX + (cx - bounds.midX) * cosine - (cy - bounds.midY) * sine
    const ry = bounds.midY + (cx - bounds.midX) * sine + (cy - bounds.midY) * cosine
    return bump(element, {
      x: rx - element.width / 2,
      y: ry - element.height / 2,
      angle: normalizedAngle(element.angle + delta),
    } as Partial<T>)
  })
}

export function resetRotation<T extends CanvasElementLike>(elements: readonly T[], selectedIds: ReadonlySet<string>): T[] {
  return elements.map(element => selectedIds.has(element.id) && !element.isDeleted && element.angle
    ? bump(element, { angle: 0 } as Partial<T>)
    : element)
}

export function flipSelection<T extends CanvasElementLike>(elements: readonly T[], selectedIds: ReadonlySet<string>, axis: DistributeAxis): T[] {
  const selected = activeSelected(elements, selectedIds)
  const bounds = commonBounds(selected)
  if (!bounds) return [...elements]
  return elements.map(element => {
    if (!selectedIds.has(element.id) || element.isDeleted) return element
    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    const points = element.points?.map(point => axis === 'x'
      ? [element.width - point[0], point[1]] as CanvasPoint
      : [point[0], element.height - point[1]] as CanvasPoint)
    return bump(element, {
      x: axis === 'x' ? 2 * bounds.midX - cx - element.width / 2 : element.x,
      y: axis === 'y' ? 2 * bounds.midY - cy - element.height / 2 : element.y,
      angle: normalizedAngle(axis === 'x' ? Math.PI - element.angle : -element.angle),
      ...(points ? { points } : {}),
    } as Partial<T>)
  })
}

export function selectSame<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  mode: SameSelectionMode,
): Record<string, true> {
  const source = activeSelected(elements, selectedIds)[0]
  if (!source) return {}
  const sourceIsRichText = Boolean(source.customData?.canvasRichText)
  const sourceCanvasShape = source.customData?.canvasShape as Record<string, unknown> | undefined
  const sourceShapeKind = typeof sourceCanvasShape?.kind === 'string' ? sourceCanvasShape.kind : null
  return Object.fromEntries(elements.filter(element => {
    if (element.isDeleted || element.locked) return false
    if (mode === 'type') {
      const candidateIsRichText = Boolean(element.customData?.canvasRichText)
      const candidateShape = element.customData?.canvasShape as Record<string, unknown> | undefined
      const candidateKind = typeof candidateShape?.kind === 'string' ? candidateShape.kind : null
      if (sourceShapeKind) return candidateKind === sourceShapeKind
      return sourceIsRichText ? candidateIsRichText : element.type === source.type && !candidateIsRichText && !candidateKind
    }
    if (mode === 'stroke') return element.strokeColor === source.strokeColor
    return element.backgroundColor === source.backgroundColor
  }).map(element => [element.id, true]))
}

export function setConnectorRouting<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  routing: ConnectorRouting,
): T[] {
  return elements.map(element => {
    if (!selectedIds.has(element.id) || element.isDeleted || element.type !== 'arrow') return element
    const points = element.points ?? []
    const first = points[0]
    const last = points.at(-1)
    const directPoints = first && last ? [first, last] : points
    if (routing === 'elbow') {
      return bump(element, { elbowed: true, roundness: null, fixedSegments: null, points: directPoints } as Partial<T>)
    }
    if (routing === 'curved' && first && last) {
      const dx = last[0] - first[0]
      const dy = last[1] - first[1]
      const length = Math.max(1, Math.hypot(dx, dy))
      const bend = Math.min(52, Math.max(18, length * 0.16))
      const normalX = -dy / length
      const normalY = dx / length
      const middle: CanvasPoint = [
        (first[0] + last[0]) / 2 + normalX * bend,
        (first[1] + last[1]) / 2 + normalY * bend,
      ]
      return bump(element, {
        elbowed: false,
        roundness: { type: 2 },
        fixedSegments: null,
        points: [first, middle, last],
      } as Partial<T>)
    }
    return bump(element, {
      elbowed: false,
      roundness: null,
      fixedSegments: null,
      points: directPoints,
    } as Partial<T>)
  })
}

export function setConnectorArrowheads<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  startArrowhead: ConnectorArrowhead,
  endArrowhead: ConnectorArrowhead,
): T[] {
  return elements.map(element => selectedIds.has(element.id) && !element.isDeleted && element.type === 'arrow'
    ? bump(element, { startArrowhead, endArrowhead } as Partial<T>)
    : element)
}

function removeBoundConnector<T extends CanvasElementLike>(element: T, connectorId: string): T {
  if (!element.boundElements?.some(bound => bound.id === connectorId)) return element
  return bump(element, {
    boundElements: element.boundElements.filter(bound => bound.id !== connectorId),
  } as Partial<T>)
}

export function bindConnectorEndpoint<T extends CanvasElementLike>(
  elements: readonly T[],
  connectorId: string,
  targetId: string,
  endpoint: 'start' | 'end',
): T[] {
  const connector = elements.find(element => element.id === connectorId)
  const target = elements.find(element => element.id === targetId)
  if (!connector || !target || connector.type !== 'arrow' || connector.isDeleted || target.isDeleted || connector.id === target.id) return [...elements]
  const previous = endpoint === 'start' ? connector.startBinding : connector.endBinding
  const binding: CanvasBinding = { elementId: target.id, fixedPoint: [0.5, 0.5], mode: 'orbit' }
  return elements.map(element => {
    if (previous?.elementId === element.id && element.id !== target.id) return removeBoundConnector(element, connector.id)
    if (element.id === target.id) {
      const boundElements = [...(element.boundElements ?? []).filter(bound => bound.id !== connector.id), { id: connector.id, type: 'arrow' }]
      return bump(element, { boundElements } as Partial<T>)
    }
    if (element.id === connector.id) {
      return bump(element, (endpoint === 'start'
        ? { startBinding: binding }
        : { endBinding: binding }) as Partial<T>)
    }
    return element
  })
}

export function detachConnectorEndpoint<T extends CanvasElementLike>(
  elements: readonly T[],
  connectorId: string,
  endpoint: 'start' | 'end',
): T[] {
  const connector = elements.find(element => element.id === connectorId)
  if (!connector || connector.type !== 'arrow') return [...elements]
  const binding = endpoint === 'start' ? connector.startBinding : connector.endBinding
  return elements.map(element => {
    if (binding?.elementId === element.id) return removeBoundConnector(element, connector.id)
    if (element.id !== connector.id) return element
    return bump(element, (endpoint === 'start'
      ? { startBinding: null }
      : { endBinding: null }) as Partial<T>)
  })
}

export function reverseConnector<T extends CanvasElementLike>(
  elements: readonly T[],
  connectorId: string,
): T[] {
  return elements.map(element => element.id === connectorId && element.type === 'arrow' && !element.isDeleted
    ? bump(element, {
        startArrowhead: element.endArrowhead ?? null,
        endArrowhead: element.startArrowhead ?? null,
        startBinding: element.endBinding ?? null,
        endBinding: element.startBinding ?? null,
      } as Partial<T>)
    : element)
}

export function copyVisualStyle(element: CanvasElementLike): VisualStyle {
  return {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
    roundness: element.roundness ? structuredClone(element.roundness) : element.roundness,
    startArrowhead: element.startArrowhead,
    endArrowhead: element.endArrowhead,
  }
}

export function pasteVisualStyle<T extends CanvasElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  style: VisualStyle,
): T[] {
  return elements.map(element => {
    if (!selectedIds.has(element.id) || element.isDeleted) return element
    const patch = Object.fromEntries(
      Object.entries(style).filter(([key, value]) => {
        if (value === undefined) return false
        if ((key === 'startArrowhead' || key === 'endArrowhead') && element.type !== 'arrow' && element.type !== 'line') return false
        return true
      }),
    ) as Partial<T>
    return bump(element, patch)
  })
}


export function selectFrameContents<T extends CanvasElementLike>(
  elements: readonly T[],
  frameId: string,
): Record<string, true> {
  return Object.fromEntries(
    elements.filter(element => !element.isDeleted && element.frameId === frameId && !element.locked).map(element => [element.id, true]),
  )
}
