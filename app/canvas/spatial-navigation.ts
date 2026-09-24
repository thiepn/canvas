export type SpatialElementLike = {
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
  frameId?: string | null
  boundElements?: readonly { id: string; type: string }[] | null
  locked?: boolean
  name?: string | null
  text?: string
  originalText?: string
  customData?: Record<string, unknown>
  [key: string]: unknown
}

export type SpatialBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  midX: number
  midY: number
}

export type SpatialSearchResult = {
  id: string
  type: 'text' | 'rich-text' | 'frame'
  label: string
  score: number
}

const randomInt = () => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  return Math.floor(Math.random() * 0x7fffffff)
}

function bump<T extends SpatialElementLike>(element: T, patch: Partial<T>): T {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  } as T
}

export function spatialElementBounds(element: SpatialElementLike): SpatialBounds {
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

export function spatialBounds(elements: readonly SpatialElementLike[]): SpatialBounds | null {
  const active = elements.filter(element => !element.isDeleted)
  if (!active.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const element of active) {
    const bounds = spatialElementBounds(element)
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2 }
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function richHtmlToPlainText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .trim(),
  )
}

export function searchableText(element: SpatialElementLike): { type: SpatialSearchResult['type']; text: string } | null {
  if (element.isDeleted) return null
  if (element.type === 'frame') {
    const name = typeof element.name === 'string' ? element.name.trim() : ''
    return name ? { type: 'frame', text: name } : null
  }
  if (element.type === 'text') {
    const value = typeof element.text === 'string' ? element.text : typeof element.originalText === 'string' ? element.originalText : ''
    return value.trim() ? { type: 'text', text: value.trim() } : null
  }
  const rich = element.customData?.canvasRichText
  if (rich && typeof rich === 'object') {
    const html = (rich as Record<string, unknown>).html
    if (typeof html === 'string') {
      const value = richHtmlToPlainText(html)
      return value ? { type: 'rich-text', text: value } : null
    }
  }
  return null
}

export function searchSpatialElements(elements: readonly SpatialElementLike[], query: string, limit = 40): SpatialSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const terms = needle.split(/\s+/).filter(Boolean)
  const results: SpatialSearchResult[] = []
  for (const element of elements) {
    const searchable = searchableText(element)
    if (!searchable) continue
    const haystack = searchable.text.toLocaleLowerCase()
    if (!terms.every(term => haystack.includes(term))) continue
    let score = 0
    if (haystack === needle) score += 100
    if (haystack.startsWith(needle)) score += 40
    const first = haystack.indexOf(needle)
    if (first >= 0) score += Math.max(0, 30 - Math.min(30, first))
    score += Math.max(0, 20 - Math.min(20, searchable.text.length / 20))
    results.push({
      id: element.id,
      type: searchable.type,
      label: searchable.text.replace(/\s+/g, ' ').slice(0, 160),
      score,
    })
  }
  return results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit)
}

export function frameContents<T extends SpatialElementLike>(elements: readonly T[], frameId: string): T[] {
  return elements.filter(element => !element.isDeleted && element.frameId === frameId)
}

export function fitFrameToContents<T extends SpatialElementLike>(
  elements: readonly T[],
  frameId: string,
  padding = 32,
): T[] {
  const children = frameContents(elements, frameId)
  const bounds = spatialBounds(children)
  if (!bounds) return [...elements]
  const pad = Math.max(0, padding)
  return elements.map(element => {
    if (element.id !== frameId || element.type !== 'frame' || element.isDeleted) return element
    return bump(element, {
      x: bounds.minX - pad,
      y: bounds.minY - pad,
      width: Math.max(1, bounds.width + pad * 2),
      height: Math.max(1, bounds.height + pad * 2),
      angle: 0,
    } as Partial<T>)
  })
}

export function assignElementsToFrame<T extends SpatialElementLike>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
  frameId: string,
): T[] {
  const selected = new Set(selectedIds)
  for (const element of elements) {
    if (!selected.has(element.id)) continue
    for (const bound of element.boundElements ?? []) if (bound.type === 'text') selected.add(bound.id)
  }
  return elements.map(element => {
    if (!selected.has(element.id) || element.id === frameId || element.type === 'frame' || element.isDeleted) return element
    return bump(element, { frameId } as Partial<T>)
  })
}

export function setFrameContentsLocked<T extends SpatialElementLike>(
  elements: readonly T[],
  frameId: string,
  locked: boolean,
): T[] {
  return elements.map(element => element.frameId === frameId && !element.isDeleted
    ? bump(element, { locked } as Partial<T>)
    : element)
}

export function renameFrame<T extends SpatialElementLike>(
  elements: readonly T[],
  frameId: string,
  name: string,
): T[] {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80)
  return elements.map(element => element.id === frameId && element.type === 'frame' && !element.isDeleted
    ? bump(element, { name: clean || null } as Partial<T>)
    : element)
}

export function viewportSceneBounds(appState: {
  scrollX: number
  scrollY: number
  zoom: { value: number }
  width: number
  height: number
}): SpatialBounds {
  const zoom = Math.max(0.01, appState.zoom.value)
  const minX = -appState.scrollX
  const minY = -appState.scrollY
  const width = appState.width / zoom
  const height = appState.height / zoom
  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
    width,
    height,
    midX: minX + width / 2,
    midY: minY + height / 2,
  }
}
