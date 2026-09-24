export type SpatialIndexElement = {
  id: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  version: number
  versionNonce: number
  isDeleted: boolean
}

export type SpatialIndexBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type Entry<T> = {
  element: T
  bounds: SpatialIndexBounds
  cells: string[]
  order: number
  version: number
  versionNonce: number
  isDeleted: boolean
}

export type SpatialSyncStats = {
  scanned: number
  indexed: number
  changed: number
  removed: number
}

const LARGE_CELL_LIMIT = 144
const MAX_QUERY_CELLS = 4096

function rotatedBounds(element: SpatialIndexElement): SpatialIndexBounds {
  const width = Math.abs(element.width)
  const height = Math.abs(element.height)
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const cosine = Math.abs(Math.cos(element.angle || 0))
  const sine = Math.abs(Math.sin(element.angle || 0))
  const extentX = (width * cosine + height * sine) / 2
  const extentY = (width * sine + height * cosine) / 2
  return {
    minX: centerX - extentX,
    minY: centerY - extentY,
    maxX: centerX + extentX,
    maxY: centerY + extentY,
  }
}

function intersects(a: SpatialIndexBounds, b: SpatialIndexBounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY
}

export function viewportBounds(appState: {
  scrollX: number
  scrollY: number
  zoom: { value: number }
  width: number
  height: number
}, overscanPixels = 240): SpatialIndexBounds {
  const zoom = Math.max(0.01, appState.zoom.value)
  const overscan = Math.max(0, overscanPixels) / zoom
  const minX = -appState.scrollX - overscan
  const minY = -appState.scrollY - overscan
  return {
    minX,
    minY,
    maxX: -appState.scrollX + appState.width / zoom + overscan,
    maxY: -appState.scrollY + appState.height / zoom + overscan,
  }
}

function sameStamp<T extends SpatialIndexElement>(entry: Entry<T>, element: T): boolean {
  return entry.version === element.version
    && entry.versionNonce === element.versionNonce
    && entry.isDeleted === element.isDeleted
}

export class SpatialGridIndex<T extends SpatialIndexElement> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly buckets = new Map<string, Set<string>>()
  private readonly large = new Set<string>()
  private readonly cellSize: number

  constructor(cellSize = 512) {
    if (!Number.isFinite(cellSize) || cellSize < 32) throw new Error('Spatial index cell size must be at least 32.')
    this.cellSize = cellSize
  }

  private cellRange(bounds: SpatialIndexBounds) {
    return {
      minX: Math.floor(bounds.minX / this.cellSize),
      minY: Math.floor(bounds.minY / this.cellSize),
      maxX: Math.floor(bounds.maxX / this.cellSize),
      maxY: Math.floor(bounds.maxY / this.cellSize),
    }
  }

  private cellKeys(bounds: SpatialIndexBounds, cap = LARGE_CELL_LIMIT): string[] | null {
    const range = this.cellRange(bounds)
    const width = range.maxX - range.minX + 1
    const height = range.maxY - range.minY + 1
    if (width * height > cap) return null
    const keys: string[] = []
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) keys.push(`${x}:${y}`)
    }
    return keys
  }

  private removeEntry(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    for (const key of entry.cells) {
      const bucket = this.buckets.get(key)
      if (!bucket) continue
      bucket.delete(id)
      if (!bucket.size) this.buckets.delete(key)
    }
    this.large.delete(id)
    this.entries.delete(id)
    return true
  }

  private addEntry(element: T, order: number): void {
    const bounds = rotatedBounds(element)
    const keys = this.cellKeys(bounds)
    const entry: Entry<T> = {
      element,
      bounds,
      cells: keys ?? [],
      order,
      version: element.version,
      versionNonce: element.versionNonce,
      isDeleted: element.isDeleted,
    }
    this.entries.set(element.id, entry)
    if (keys === null) {
      this.large.add(element.id)
      return
    }
    for (const key of keys) {
      const bucket = this.buckets.get(key) ?? new Set<string>()
      bucket.add(element.id)
      this.buckets.set(key, bucket)
    }
  }

  sync(elements: readonly T[], include: (element: T) => boolean = () => true): SpatialSyncStats {
    const seen = new Set<string>()
    let changed = 0
    let removed = 0
    for (let order = 0; order < elements.length; order++) {
      const element = elements[order]
      const eligible = !element.isDeleted && include(element)
      if (!eligible) {
        if (this.removeEntry(element.id)) removed += 1
        continue
      }
      seen.add(element.id)
      const previous = this.entries.get(element.id)
      if (previous && sameStamp(previous, element)) {
        previous.element = element
        previous.order = order
        continue
      }
      if (previous) this.removeEntry(element.id)
      this.addEntry(element, order)
      changed += 1
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id) && this.removeEntry(id)) removed += 1
    }
    return { scanned: elements.length, indexed: this.entries.size, changed, removed }
  }

  query(bounds: SpatialIndexBounds): T[] {
    const range = this.cellRange(bounds)
    const width = range.maxX - range.minX + 1
    const height = range.maxY - range.minY + 1
    const ids = new Set<string>(this.large)
    if (width * height > MAX_QUERY_CELLS) {
      for (const id of this.entries.keys()) ids.add(id)
    } else {
      for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
          for (const id of this.buckets.get(`${x}:${y}`) ?? []) ids.add(id)
        }
      }
    }
    const result: Entry<T>[] = []
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && intersects(entry.bounds, bounds)) result.push(entry)
    }
    result.sort((a, b) => a.order - b.order)
    return result.map(entry => entry.element)
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.element
  }

  clear(): void {
    this.entries.clear()
    this.buckets.clear()
    this.large.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
