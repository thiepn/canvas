import { LIMITS } from './limits.ts'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Iterative traversal: malicious nesting cannot overflow our own call stack. */
export function isSafeJson(value: unknown, maxDepth: number = LIMITS.jsonDepth): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const visited = new Set<object>()
  let nodes = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++nodes > LIMITS.jsonNodes || item.depth > maxDepth) return false
    const current = item.value
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false
      continue
    }
    if (typeof current !== 'object' || visited.has(current)) return false
    visited.add(current)
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false
    for (const [key, child] of Object.entries(current)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false
      stack.push({ value: child, depth: item.depth + 1 })
    }
  }
  return true
}

export function parseBoundedJson(text: string, maxBytes: number = LIMITS.messageBytes): unknown {
  if (byteLength(text) > maxBytes) throw new Error('Payload exceeds the size limit.')
  const value: unknown = JSON.parse(text)
  if (!isSafeJson(value)) throw new Error('Payload has invalid or excessive structure.')
  return value
}
