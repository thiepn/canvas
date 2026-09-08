import { ALLOWED_GEOMETRIES, ALLOWED_SHAPES, LIMITS, PRIMARY_PAGE_ID } from './limits.ts'
import { byteLength, isObject, isSafeJson } from './json.ts'

export interface CanvasRecord { id: string; typeName: string; [key: string]: unknown }

export function isAllowedUrl(value: unknown): boolean {
  if (value === '' || value === undefined || value === null) return true
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

function textIsAllowed(value: unknown): boolean {
  let count = 0
  const stack: unknown[] = [value]
  while (stack.length) {
    const item = stack.pop()
    if (Array.isArray(item)) { stack.push(...item); continue }
    if (!isObject(item)) continue
    for (const [key, child] of Object.entries(item)) {
      if ((key === 'text' || key === 'name') && typeof child === 'string') count += child.length
      if ((key === 'href' || key === 'url' || key === 'src') && !isAllowedUrl(child)) return false
      if (key === 'type' && typeof child === 'string' && ['image', 'video', 'audio', 'iframe', 'embed'].includes(child)) return false
      if (typeof child === 'object' && child !== null) stack.push(child)
    }
    if (count > LIMITS.textCharacters) return false
  }
  return true
}

/** Runs after the engine's own schema migration/validation, and before any durable write. */
export function validateCanvasRecord(record: unknown): record is CanvasRecord {
  if (!isObject(record) || !isSafeJson(record)) return false
  if (typeof record.id !== 'string' || record.id.length > 200 || typeof record.typeName !== 'string') return false
  if (byteLength(JSON.stringify(record)) > LIMITS.recordBytes) return false
  if (record.meta !== undefined && (!isObject(record.meta) || Object.keys(record.meta).length !== 0)) return false
  if (!textIsAllowed(record)) return false
  switch (record.typeName) {
    case 'asset': return false
    case 'page': return record.id === PRIMARY_PAGE_ID
    case 'document': return record.id === 'document:document'
    case 'binding': return record.type === 'arrow' && record.id.startsWith('binding:')
    case 'shape': {
      if (!record.id.startsWith('shape:') || typeof record.type !== 'string' || !ALLOWED_SHAPES.has(record.type)) return false
      if (typeof record.parentId !== 'string' || (record.parentId !== PRIMARY_PAGE_ID && !record.parentId.startsWith('shape:')) || record.parentId === record.id) return false
      if (!isObject(record.props)) return false
      if (record.type === 'geo' && (typeof record.props.geo !== 'string' || !ALLOWED_GEOMETRIES.has(record.props.geo))) return false
      for (const key of ['x', 'y', 'rotation']) {
        if (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || Math.abs(record[key]) > LIMITS.coordinate) return false
      }
      for (const key of ['w', 'h', 'scale']) {
        const value = record.props[key]
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS.coordinate)) return false
      }
      return true
    }
    default: return false
  }
}

/** Full-scene validation is for imports/backups, never for every cursor or drag event. */
export function validateWorldRecords(records: unknown[]): CanvasRecord[] {
  if (records.length > LIMITS.shapes * 3 + 2) throw new Error('Too many records.')
  const ids = new Set<string>()
  const validated: CanvasRecord[] = []
  let bytes = 0
  let pages = 0
  let documents = 0
  let shapes = 0
  for (const record of records) {
    if (!validateCanvasRecord(record)) throw new Error('Backup contains an unsupported or invalid record.')
    if (ids.has(record.id)) throw new Error('Backup contains duplicate IDs.')
    ids.add(record.id)
    bytes += byteLength(JSON.stringify(record))
    if (bytes > LIMITS.worldBytes) throw new Error('The world exceeds the 8 MiB document budget.')
    if (record.typeName === 'page') pages++
    if (record.typeName === 'document') documents++
    if (record.typeName === 'shape') shapes++
    validated.push(record)
  }
  if (pages !== 1 || documents !== 1) throw new Error('A Canvas backup must have exactly one document and one main page.')
  if (shapes > LIMITS.shapes) throw new Error('The world exceeds the shape limit.')
  const byId = new Map(validated.map(record => [record.id, record]))
  for (const record of validated) {
    if (record.typeName !== 'shape') continue
    const seen = new Set<string>([record.id])
    let parent = record.parentId as string
    while (parent !== PRIMARY_PAGE_ID) {
      if (seen.has(parent)) throw new Error('Shape parent cycle detected.')
      seen.add(parent)
      if (seen.size > 256) throw new Error('Shape nesting exceeds the safe limit.')
      const candidate = byId.get(parent)
      if (!candidate || candidate.typeName !== 'shape' || !['frame', 'group'].includes(candidate.type as string)) throw new Error('A shape has an invalid parent.')
      parent = candidate.parentId as string
    }
  }
  return validated
}
