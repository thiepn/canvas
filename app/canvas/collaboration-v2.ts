export type CollaborationActivity = 'idle' | 'drawing' | 'typing'
export type CollaborationTool = 'pointer' | 'laser'
export type CollaborationButton = 'up' | 'down'
export type CollaborationReaction = '👍' | '❤️' | '🎉' | '😂' | '👏' | '✨'

export type CollaborationPointer = {
  x: number
  y: number
  tool: CollaborationTool
  button: CollaborationButton
}

export type CollaborationViewport = {
  scrollX: number
  scrollY: number
  zoom: number
  width: number
  height: number
}

export type CollaborationStatePayload = {
  protocol: 2
  deviceId: string
  sessionId: string
  sequence: number
  sentAt: number
  displayName: string
  color: string
  cursorVisible: boolean
  pointer: CollaborationPointer | null
  selectedElementIds: string[]
  viewport: CollaborationViewport
  activity: CollaborationActivity
}

export type CollaborationEffectPayload = {
  protocol: 2
  kind: 'ping' | 'reaction'
  deviceId: string
  sessionId: string
  sequence: number
  sentAt: number
  displayName: string
  color: string
  targetDeviceId: string | null
  point: { x: number; y: number }
  emoji: CollaborationReaction | null
}

export type RemoteCollaborationState = CollaborationStatePayload & {
  receivedAt: number
}

export type CollaborationEffectView = CollaborationEffectPayload & {
  effectId: string
  expiresAt: number
}

export const COLLABORATION_STATE_MAX_BYTES = 12 * 1024
export const COLLABORATION_EFFECT_MAX_BYTES = 2 * 1024
export const COLLABORATION_STALE_AFTER_MS = 15_000
export const COLLABORATION_IDLE_POINTER_AFTER_MS = 12_000
export const COLLABORATION_REACTION_TTL_MS = 2_200
export const COLLABORATION_REACTIONS = ['👍', '❤️', '🎉', '😂', '👏', '✨'] as const

const MAX_COORDINATE = 10_000_000
const MAX_SELECTED_IDS = 256
const MAX_ID_LENGTH = 160

function byteSize(value: unknown): number {
  const serialized = JSON.stringify(value)
  return typeof TextEncoder === 'undefined' ? serialized.length : new TextEncoder().encode(serialized).length
}

function safeString(value: unknown, max = MAX_ID_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeSelectedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_IDS) return null
  const unique = new Set<string>()
  for (const id of value) {
    const safe = safeString(id, 128)
    if (!safe) return null
    unique.add(safe)
  }
  return [...unique]
}

function normalizePointer(value: unknown): CollaborationPointer | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const pointer = value as Record<string, unknown>
  if (!finiteCoordinate(pointer.x) || !finiteCoordinate(pointer.y)) return undefined
  const tool = pointer.tool === 'laser' ? 'laser' : pointer.tool === 'pointer' ? 'pointer' : null
  const button = pointer.button === 'down' ? 'down' : pointer.button === 'up' ? 'up' : null
  if (!tool || !button) return undefined
  return { x: pointer.x, y: pointer.y, tool, button }
}

function normalizeViewport(value: unknown): CollaborationViewport | null {
  if (!value || typeof value !== 'object') return null
  const viewport = value as Record<string, unknown>
  if (!finiteCoordinate(viewport.scrollX) || !finiteCoordinate(viewport.scrollY)) return null
  if (!finitePositive(viewport.zoom) || viewport.zoom < 0.05 || viewport.zoom > 10) return null
  if (!finitePositive(viewport.width) || !finitePositive(viewport.height) || viewport.width > 100_000 || viewport.height > 100_000) return null
  return {
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    zoom: viewport.zoom,
    width: viewport.width,
    height: viewport.height,
  }
}

export function createCollaborationStatePayload(input: Omit<CollaborationStatePayload, 'protocol'>): CollaborationStatePayload | null {
  const deviceId = safeString(input.deviceId)
  const sessionId = safeString(input.sessionId)
  if (!deviceId || !sessionId || !Number.isSafeInteger(input.sequence) || input.sequence <= 0 || !finitePositive(input.sentAt)) return null
  if (typeof input.displayName !== 'string' || input.displayName.length > 64 || !validColor(input.color)) return null
  if (typeof input.cursorVisible !== 'boolean') return null
  const pointer = normalizePointer(input.pointer)
  const selectedElementIds = normalizeSelectedIds(input.selectedElementIds)
  const viewport = normalizeViewport(input.viewport)
  if (pointer === undefined || !selectedElementIds || !viewport) return null
  if (!['idle', 'drawing', 'typing'].includes(input.activity)) return null

  const payload: CollaborationStatePayload = {
    protocol: 2,
    deviceId,
    sessionId,
    sequence: input.sequence,
    sentAt: input.sentAt,
    displayName: input.displayName.slice(0, 64),
    color: input.color,
    cursorVisible: input.cursorVisible,
    pointer,
    selectedElementIds,
    viewport,
    activity: input.activity,
  }
  return byteSize(payload) <= COLLABORATION_STATE_MAX_BYTES ? payload : null
}

export function parseCollaborationStatePayload(value: unknown): CollaborationStatePayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.protocol !== 2) return null
  return createCollaborationStatePayload({
    deviceId: raw.deviceId as string,
    sessionId: raw.sessionId as string,
    sequence: Number(raw.sequence),
    sentAt: Number(raw.sentAt),
    displayName: raw.displayName as string,
    color: raw.color as string,
    cursorVisible: raw.cursorVisible as boolean,
    pointer: raw.pointer as CollaborationPointer | null,
    selectedElementIds: raw.selectedElementIds as string[],
    viewport: raw.viewport as CollaborationViewport,
    activity: raw.activity as CollaborationActivity,
  })
}

export function createCollaborationEffectPayload(input: Omit<CollaborationEffectPayload, 'protocol'>): CollaborationEffectPayload | null {
  const deviceId = safeString(input.deviceId)
  const sessionId = safeString(input.sessionId)
  const targetDeviceId = input.targetDeviceId === null ? null : safeString(input.targetDeviceId)
  if (!deviceId || !sessionId || input.targetDeviceId !== null && !targetDeviceId) return null
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 || !finitePositive(input.sentAt)) return null
  if (typeof input.displayName !== 'string' || input.displayName.length > 64 || !validColor(input.color)) return null
  if (!finiteCoordinate(input.point.x) || !finiteCoordinate(input.point.y)) return null
  if (input.kind !== 'ping' && input.kind !== 'reaction') return null
  const emoji = input.kind === 'reaction' && COLLABORATION_REACTIONS.includes(input.emoji as CollaborationReaction)
    ? input.emoji as CollaborationReaction
    : null
  if (input.kind === 'reaction' && !emoji) return null
  if (input.kind === 'ping' && input.emoji !== null) return null

  const payload: CollaborationEffectPayload = {
    protocol: 2,
    kind: input.kind,
    deviceId,
    sessionId,
    sequence: input.sequence,
    sentAt: input.sentAt,
    displayName: input.displayName.slice(0, 64),
    color: input.color,
    targetDeviceId,
    point: { x: input.point.x, y: input.point.y },
    emoji,
  }
  return byteSize(payload) <= COLLABORATION_EFFECT_MAX_BYTES ? payload : null
}

export function parseCollaborationEffectPayload(value: unknown): CollaborationEffectPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.protocol !== 2 || !raw.point || typeof raw.point !== 'object') return null
  const point = raw.point as Record<string, unknown>
  return createCollaborationEffectPayload({
    kind: raw.kind as 'ping' | 'reaction',
    deviceId: raw.deviceId as string,
    sessionId: raw.sessionId as string,
    sequence: Number(raw.sequence),
    sentAt: Number(raw.sentAt),
    displayName: raw.displayName as string,
    color: raw.color as string,
    targetDeviceId: raw.targetDeviceId === null ? null : raw.targetDeviceId as string,
    point: { x: Number(point.x), y: Number(point.y) },
    emoji: raw.emoji === null ? null : raw.emoji as CollaborationReaction,
  })
}

export class CollaborationSequenceGate {
  private readonly sessions = new Map<string, { sessionId: string; sequence: number }>()

  accept(deviceId: string, sessionId: string, sequence: number): boolean {
    if (!deviceId || !sessionId || !Number.isSafeInteger(sequence) || sequence <= 0) return false
    const current = this.sessions.get(deviceId)
    if (!current || current.sessionId !== sessionId) {
      this.sessions.set(deviceId, { sessionId, sequence })
      return true
    }
    if (sequence <= current.sequence) return false
    current.sequence = sequence
    return true
  }

  remove(deviceId: string): void {
    this.sessions.delete(deviceId)
  }

  clear(): void {
    this.sessions.clear()
  }
}

export function isStaleCollaborationPayload(sentAt: number, now = Date.now(), maxAgeMs = COLLABORATION_STALE_AFTER_MS): boolean {
  return !Number.isFinite(sentAt) || sentAt > now + 60_000 || now - sentAt > maxAgeMs
}

export function viewportCenter(viewport: CollaborationViewport): { x: number; y: number } {
  return {
    x: viewport.width / (2 * viewport.zoom) - viewport.scrollX,
    y: viewport.height / (2 * viewport.zoom) - viewport.scrollY,
  }
}

export function followerViewport(
  remote: CollaborationViewport,
  local: Pick<CollaborationViewport, 'width' | 'height'>,
): Pick<CollaborationViewport, 'scrollX' | 'scrollY' | 'zoom'> {
  const center = viewportCenter(remote)
  const zoom = Math.max(0.1, Math.min(4, remote.zoom))
  return {
    zoom,
    scrollX: local.width / (2 * zoom) - center.x,
    scrollY: local.height / (2 * zoom) - center.y,
  }
}

export function cursorSmoothingAlpha(deltaMs: number, halfLifeMs = 55): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 1
  return Math.min(1, Math.max(0, 1 - Math.pow(2, -deltaMs / halfLifeMs)))
}
