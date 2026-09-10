import { isNewerVersion, type VersionStamp } from './sync-version.ts'

export const CANVAS_PREVIEW_PROTOCOL = 1 as const
export const CANVAS_PREVIEW_TTL_MS = 1400
export const CANVAS_PREVIEW_MAX_ELEMENTS = 64
export const CANVAS_PREVIEW_MAX_BYTES = 512 * 1024

export type CanvasPreviewSource = 'pointer' | 'text'

export type CanvasPreviewElement = {
  readonly id: string
  readonly version: number
  readonly versionNonce: number
  readonly isDeleted: boolean
  readonly [key: string]: unknown
}

export type CanvasPreviewPayload<T extends CanvasPreviewElement = CanvasPreviewElement> = {
  protocol: typeof CANVAS_PREVIEW_PROTOCOL
  deviceId: string
  sessionId: string
  sequence: number
  sentAt: number
  source: CanvasPreviewSource
  elements: T[]
}

function encodedBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return null
  }
}

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isPreviewElementEnvelope(value: unknown): value is CanvasPreviewElement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const element = value as Record<string, unknown>
  return validId(element.id)
    && Number.isSafeInteger(element.version)
    && Number(element.version) >= 0
    && Number.isSafeInteger(element.versionNonce)
    && typeof element.isDeleted === 'boolean'
}

export function createCanvasPreviewPayload<T extends CanvasPreviewElement>(input: Omit<CanvasPreviewPayload<T>, 'protocol' | 'sentAt'> & { sentAt?: number }): CanvasPreviewPayload<T> | null {
  const payload: CanvasPreviewPayload<T> = {
    protocol: CANVAS_PREVIEW_PROTOCOL,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    sentAt: input.sentAt ?? Date.now(),
    source: input.source,
    elements: input.elements,
  }
  return parseCanvasPreviewPayload(payload) as CanvasPreviewPayload<T> | null
}

export function parseCanvasPreviewPayload(value: unknown): CanvasPreviewPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  if (payload.protocol !== CANVAS_PREVIEW_PROTOCOL) return null
  if (!validId(payload.deviceId, 128) || !validId(payload.sessionId, 128)) return null
  if (!Number.isSafeInteger(payload.sequence) || Number(payload.sequence) <= 0) return null
  if (!Number.isSafeInteger(payload.sentAt) || Number(payload.sentAt) <= 0) return null
  if (payload.source !== 'pointer' && payload.source !== 'text') return null
  if (!Array.isArray(payload.elements) || payload.elements.length === 0 || payload.elements.length > CANVAS_PREVIEW_MAX_ELEMENTS) return null
  if (!payload.elements.every(isPreviewElementEnvelope)) return null
  const bytes = encodedBytes(value)
  if (bytes === null || bytes > CANVAS_PREVIEW_MAX_BYTES) return null
  return payload as unknown as CanvasPreviewPayload
}

export function sameVersionStamp(a: VersionStamp, b: VersionStamp): boolean {
  return a.version === b.version && a.versionNonce === b.versionNonce && a.isDeleted === b.isDeleted
}

/** Ephemeral previews never overwrite active local work and must advance durable authority. */
export function shouldRenderPreview(preview: VersionStamp, authoritative: VersionStamp | undefined, hasLocalPending: boolean): boolean {
  return !hasLocalPending && isNewerVersion(preview, authoritative)
}

/** Monotonic ordering is scoped to a random tab session so a reload may restart at sequence 1. */
export class PreviewSequenceGate {
  private readonly sessions = new Map<string, { deviceId: string; sequence: number }>()

  accept(deviceId: string, sessionId: string, sequence: number): boolean {
    const previous = this.sessions.get(sessionId)
    if (previous && (previous.deviceId !== deviceId || sequence <= previous.sequence)) return false
    this.sessions.set(sessionId, { deviceId, sequence })
    return true
  }

  clear(): void {
    this.sessions.clear()
  }
}
