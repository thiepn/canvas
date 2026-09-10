import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CaptureUpdateAction, DefaultSidebar, Excalidraw, MainMenu, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { Icon } from '../components/Icon.tsx'
import { browserStorage, cleanName, loadIdentity, saveIdentity, type Identity } from '../presence/identity.ts'
import { loadTheme, writePreference, type ThemePreference } from '../storage/preferences.ts'
import type { LiveConfig } from '../config/public-config.ts'
import { recordMutationDiagnostics } from '../diagnostics/operations.ts'
import { canvasDiagnostics } from '../diagnostics/metrics.ts'
import { CanvasOperationTracker } from './operation-model.ts'
import { readRevisionPages } from './revision-sync.ts'
import { isNewerVersion, shouldKeepPending, type VersionStamp } from './sync-version.ts'
import {
  CANVAS_PREVIEW_TTL_MS,
  PreviewSequenceGate,
  createCanvasPreviewPayload,
  parseCanvasPreviewPayload,
  sameVersionStamp,
  shouldRenderPreview,
  type CanvasPreviewElement,
  type CanvasPreviewSource,
} from './preview-lane.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]
type ConnectionState = 'Connecting' | 'Synchronizing' | 'Live' | 'Reconnecting' | 'Offline' | 'Error'
type PresencePerson = { deviceId: string; displayName: string; color: string }
type SyncRow = { id: string; version: number; version_nonce: number; is_deleted: boolean; element: unknown; revision: number }
type CursorPayload = {
  deviceId: string
  displayName: string
  pointer: { x: number; y: number; tool: 'pointer' | 'laser' }
  button: 'up' | 'down'
  selectedElementIds: Record<string, boolean>
}
type RemotePreview = {
  deviceId: string
  sessionId: string
  sequence: number
  receivedAt: number
  expiresAt: number
  element: SceneElement
}
type QueuedPreview = { source: CanvasPreviewSource; elements: SceneElement[] }

const ALLOWED_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'frame'])
const OPERATION_FLUSH_DELAY_MS = 0
const RECONNECT_FLUSH_DELAY_MS = 120
const LONG_OPERATION_CHECKPOINT_MS = 1500
const PREVIEW_BROADCAST_INTERVAL_MS = 45
const PREVIEW_ECHO_GRACE_MS = 1000
const PREVIEW_ECHO_STAMPS_PER_ELEMENT = 16
const ANTI_ENTROPY_PAGE_SIZE = 500
const ANTI_ENTROPY_INTERVAL_MS = 15_000
const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: false,
  },
  tools: { image: false },
  welcomeScreen: false,
} as const

function stampOf(element: SceneElement): VersionStamp {
  return { version: element.version, versionNonce: element.versionNonce, isDeleted: element.isDeleted }
}

function previewStampKey(stamp: VersionStamp): string {
  return `${stamp.version}:${stamp.versionNonce}:${stamp.isDeleted ? 1 : 0}`
}

function normalizeRow(value: unknown): SyncRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : ''
  const version = Number(row.version)
  const versionNonce = Number(row.version_nonce)
  const revision = Number(row.revision)
  if (!id || !Number.isInteger(version) || !Number.isInteger(versionNonce) || !Number.isSafeInteger(revision) || revision <= 0 || typeof row.is_deleted !== 'boolean') return null
  return { id, version, version_nonce: versionNonce, is_deleted: row.is_deleted, element: row.element, revision }
}

function elementFromRow(row: SyncRow): SceneElement | null {
  if (!row.element || typeof row.element !== 'object') return null
  const element = row.element as Record<string, unknown>
  if (element.id !== row.id || typeof element.type !== 'string' || !ALLOWED_TYPES.has(element.type)) return null
  if (Number(element.version) !== row.version || Number(element.versionNonce) !== row.version_nonce || Boolean(element.isDeleted) !== row.is_deleted) return null
  return row.element as SceneElement
}

function isAllowedElement(element: SceneElement): boolean {
  return ALLOWED_TYPES.has(element.type)
}

function finiteCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000
}

function hasSafePoints(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 10_000
    && value.every(point => Array.isArray(point) && point.length >= 2 && finiteCoordinate(point[0]) && finiteCoordinate(point[1]))
}

/** Broadcast bypasses Postgres validation, so normalize untrusted preview objects before Excalidraw sees them. */
function elementFromPreview(value: CanvasPreviewElement): SceneElement | null {
  const raw = value as Record<string, unknown>
  if (typeof raw.type !== 'string' || !ALLOWED_TYPES.has(raw.type)) return null
  if (![raw.x, raw.y, raw.width, raw.height, raw.angle].every(finiteCoordinate)) return null
  if ((raw.type === 'line' || raw.type === 'arrow' || raw.type === 'freedraw') && !hasSafePoints(raw.points)) return null
  if (raw.type === 'text' && (typeof raw.text !== 'string' || raw.text.length > 200_000)) return null
  if (raw.link !== null && raw.link !== undefined) {
    if (typeof raw.link !== 'string' || raw.link.length > 4096 || /^\s*javascript:/i.test(raw.link)) return null
  }
  try {
    const restored = restoreElements([value as unknown as SceneElement], null, { repairBindings: false, refreshDimensions: false })
    const element = restored[0] as SceneElement | undefined
    if (!element || element.id !== value.id || element.version !== value.version || element.versionNonce !== value.versionNonce || element.isDeleted !== value.isDeleted || !isAllowedElement(element)) return null
    return element
  } catch {
    return null
  }
}

function safeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#666666'
}

function downloadBackup(api: ExcalidrawImperativeAPI | null) {
  if (!api) return
  const active = api.getSceneElements().filter(isAllowedElement)
  const payload = JSON.stringify({ type: 'canvas-backup', version: 2, engine: 'excalidraw', exportedAt: new Date().toISOString(), elements: active }, null, 2)
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `Canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function LiveHeader({ api, identity, people, status, theme, rename, changeTheme }: {
  api: ExcalidrawImperativeAPI | null
  identity: Identity
  people: PresencePerson[]
  status: ConnectionState
  theme: ThemePreference
  rename: (name: string) => void
  changeTheme: (theme: ThemePreference) => void
}) {
  const [menu, setMenu] = useState(false)
  const [name, setName] = useState(identity.displayName)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => setName(identity.displayName), [identity.displayName])
  useEffect(() => {
    if (!menu) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(false); triggerRef.current?.focus() }
    }
    const pointerdown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setMenu(false)
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('pointerdown', pointerdown)
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', pointerdown) }
  }, [menu])
  const submit = (event: FormEvent) => { event.preventDefault(); rename(name); setMenu(false); triggerRef.current?.focus() }
  const fit = () => {
    const elements = api?.getSceneElements() ?? []
    if (api && elements.length) api.scrollToContent(elements, { fitToViewport: true, animate: true })
  }
  const activateFrame = () => {
    if (!api || status !== 'Live') return
    api.setActiveTool({ type: 'frame' })
    setMenu(false)
  }
  return <header className="canvas-header live-canvas-header">
    <h1>Canvas<span className="brand-period" aria-hidden="true">.</span></h1>
    <div role="status" aria-live="polite" className={`connection connection--${status.toLowerCase()}`}><span aria-hidden="true" />{status}</div>
    <div className="header-spacer" />
    <div className="people-peek" aria-label={status === 'Live' ? `${people.length + 1} people connected` : 'No active connection'}>{status === 'Live' && people.slice(0, 3).map(person => <span key={person.deviceId} title={person.displayName} className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />)}</div>
    <button type="button" className="icon-button frame-button" aria-label="Frame tool" title="Frame tool" disabled={!api || status !== 'Live'} onClick={activateFrame}><Icon name="frame" /></button>
    <button type="button" className="icon-button fit-button" aria-label="Fit content" title="Fit all content" disabled={!api} onClick={fit}><Icon name="fit" /></button>
    <button ref={triggerRef} type="button" className="identity-trigger" aria-label="Canvas menu and presence" aria-expanded={menu} aria-controls={menu ? 'live-canvas-menu' : undefined} onClick={() => setMenu(!menu)}><span className="identity-initial" style={{ borderColor: safeColor(identity.color) }}>{identity.displayName.slice(0, 1).toUpperCase()}</span><span className="identity-name">{identity.displayName}</span><Icon name="more" /></button>
    {menu && <div ref={menuRef} id="live-canvas-menu" className="canvas-menu" aria-label="Canvas settings">
      <div className="menu-heading">ON THIS CANVAS</div>
      <div className="people-list"><div><span className="presence-dot" style={{ backgroundColor: safeColor(identity.color) }} />{identity.displayName}<small>You</small></div>{status === 'Live' && people.map(person => <div key={person.deviceId}><span className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />{person.displayName || 'Guest'}</div>)}</div>
      <form onSubmit={submit}><label htmlFor="live-display-name">Display name</label><div className="name-input"><input id="live-display-name" autoComplete="off" maxLength={32} value={name} onChange={event => setName(event.target.value)} /><button type="submit">Save</button></div></form>
      <label htmlFor="live-theme">Appearance</label><select id="live-theme" value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <div className="menu-heading menu-tools-heading">CANVAS CONTROLS</div>
      <button type="button" className="menu-action" disabled={!api || status !== 'Live'} onClick={activateFrame}><Icon name="frame" />Frame tool</button>
      <button type="button" className="menu-action" disabled={!api} onClick={() => downloadBackup(api)}><Icon name="download" />Export JSON backup</button>
      <button type="button" className="menu-action" disabled={!api} onClick={() => { fit(); setMenu(false) }}><Icon name="fit" />Fit all content</button>
      <p className="privacy-note">One shared canvas. Anyone with the link can read and change everything. Names are not verified identities.</p>
      <p className="shortcut-note">V Select · R Rectangle · D Diamond · O Ellipse · A Arrow · L Line<br />P/X Draw · T Text · E Eraser · F Frame · Space Pan · Ctrl/⌘ Z Undo</p>
    </div>}
  </header>
}

export default function SupabaseCanvasEditor({ config }: { config: LiveConfig }) {
  const storage = useMemo(browserStorage, [])
  const [identity, setIdentity] = useState(() => loadIdentity(storage))
  const identityRef = useRef(identity)
  const [theme, setTheme] = useState(() => loadTheme(storage))
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [status, setStatus] = useState<ConnectionState>('Connecting')
  const statusRef = useRef<ConnectionState>('Connecting')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const pageActiveRef = useRef(true)
  const channelCleanupRef = useRef<Promise<unknown>>(Promise.resolve())
  const retryDelayRef = useRef(1200)
  const reconciliationCursorRef = useRef(0)
  const reconciliationInFlightRef = useRef(false)
  const dropRealtimeForDiagnosticsRef = useRef(canvasDiagnostics.enabled && new URLSearchParams(window.location.search).get('dropRealtime') === '1')
  const [people, setPeople] = useState<PresencePerson[]>([])
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const shadowRef = useRef(new Map<string, VersionStamp>())
  const authoritativeElementsRef = useRef(new Map<string, SceneElement>())
  const observedSceneRef = useRef(new Map<string, VersionStamp>())
  const previewSessionIdRef = useRef(globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const previewSequenceRef = useRef(0)
  const previewSequenceGateRef = useRef(new PreviewSequenceGate())
  const remotePreviewRef = useRef(new Map<string, RemotePreview>())
  // updateScene can surface a remote preview through a later onChange callback.
  // Retain a small time-bounded set of exact immutable versions so those echoes
  // can never cross into the local operation/durability pipeline.
  const previewEchoStampsRef = useRef(new Map<string, Map<string, number>>())
  const previewSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewSendQueuedRef = useRef<QueuedPreview | null>(null)
  const previewLastSentAtRef = useRef(0)
  const commitPreviewRef = useRef<(source: CanvasPreviewSource, elements: SceneElement[]) => void>(() => {})
  // pendingRef tracks the newest local unsynchronized state for conflict protection.
  // durablePendingRef contains only mutation-final states (or explicit long-op
  // checkpoints) that are allowed to cross the network durability boundary.
  const pendingRef = useRef(new Map<string, SceneElement>())
  const durablePendingRef = useRef(new Map<string, SceneElement>())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writeInFlightRef = useRef(false)
  const continuousOperationRef = useRef<'pointer' | 'text' | null>(null)
  const durabilityCommitRef = useRef<() => void>(() => {})
  const armCheckpointRef = useRef<() => void>(() => {})
  const clearCheckpointRef = useRef<() => void>(() => {})
  const applyingRemote = useRef(false)
  const collaboratorsRef = useRef(new Map<SocketId, Collaborator>())
  const cursorAt = useRef(0)
  const editingTextRef = useRef<string | null>(null)
  const operationTracker = useMemo(() => new CanvasOperationTracker<SceneElement>({
    deviceId: () => identityRef.current.deviceId,
    onCommit: mutation => {
      recordMutationDiagnostics(mutation)
      if (mutation.source === 'pointer' || mutation.source === 'text') {
        commitPreviewRef.current(mutation.source, mutation.changes.map(change => change.type === 'delete' ? change.tombstone : change.element))
      }
      for (const change of mutation.changes) {
        const element = change.type === 'delete' ? change.tombstone : change.element
        const nextStamp = stampOf(element)
        if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
        const queued = durablePendingRef.current.get(element.id)
        if (!queued || isNewerVersion(nextStamp, stampOf(queued))) durablePendingRef.current.set(element.id, element)
      }
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
      durabilityCommitRef.current()
    },
  }), [])

  const supabase = useMemo(() => createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), [config.supabaseKey, config.supabaseUrl])

  const resolvedTheme = theme === 'system' ? systemDark ? 'dark' : 'light' : theme

  const notify = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])

  // Network callbacks must lock writes immediately, before React commits a render.
  const transition = useCallback((next: ConnectionState) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const restoreRemotePreviews = useCallback((records: RemotePreview[]) => {
    const editor = apiRef.current
    if (!editor || records.length === 0) return
    const current = editor.getSceneElementsIncludingDeleted()
    const replacements = new Map<string, SceneElement | null>()
    for (const record of records) {
      const visible = current.find(element => element.id === record.element.id)
      if (!visible || pendingRef.current.has(record.element.id)) continue
      const visibleWasPreview = (previewEchoStampsRef.current.get(record.element.id)?.get(previewStampKey(stampOf(visible))) ?? 0) > Date.now()
      if (!visibleWasPreview) continue
      replacements.set(record.element.id, authoritativeElementsRef.current.get(record.element.id) ?? null)
    }
    if (!replacements.size) return
    const next: SceneElement[] = []
    for (const element of current) {
      if (!replacements.has(element.id)) { next.push(element); continue }
      const replacement = replacements.get(element.id)
      if (replacement) next.push(replacement)
    }
    applyingRemote.current = true
    editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER })
    queueMicrotask(() => { applyingRemote.current = false })
  }, [])

  const clearRemotePreviews = useCallback(() => {
    const records = [...remotePreviewRef.current.values()]
    remotePreviewRef.current.clear()
    previewSequenceGateRef.current.clear()
    canvasDiagnostics.gauge('activeRemotePreviews', 0)
    restoreRemotePreviews(records)
  }, [restoreRemotePreviews])

  const sendPreviewNow = useCallback((source: CanvasPreviewSource, elements: SceneElement[]) => {
    if (!pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || elements.length === 0) return
    const channel = channelRef.current
    if (!channel) return
    const payload = createCanvasPreviewPayload({
      deviceId: identityRef.current.deviceId,
      sessionId: previewSessionIdRef.current,
      sequence: ++previewSequenceRef.current,
      source,
      elements: elements.filter(isAllowedElement),
    })
    if (!payload) { canvasDiagnostics.increment('previewBroadcastsSkipped'); return }
    previewLastSentAtRef.current = performance.now()
    canvasDiagnostics.increment('previewBroadcastsSent')
    canvasDiagnostics.increment('previewElementsSent', payload.elements.length)
    void channel.send({ type: 'broadcast', event: 'preview', payload }).then(result => {
      if (result !== 'ok') canvasDiagnostics.increment('previewBroadcastFailures')
    }).catch(() => { canvasDiagnostics.increment('previewBroadcastFailures') })
  }, [])

  const queuePreview = useCallback((source: CanvasPreviewSource, elements: SceneElement[], immediate = false) => {
    if (previewSendTimerRef.current && immediate) { clearTimeout(previewSendTimerRef.current); previewSendTimerRef.current = null }
    if (immediate) { previewSendQueuedRef.current = null; sendPreviewNow(source, elements); return }
    previewSendQueuedRef.current = { source, elements }
    const elapsed = performance.now() - previewLastSentAtRef.current
    if (elapsed >= PREVIEW_BROADCAST_INTERVAL_MS) {
      const queued = previewSendQueuedRef.current
      previewSendQueuedRef.current = null
      if (queued) sendPreviewNow(queued.source, queued.elements)
      return
    }
    if (previewSendTimerRef.current) return
    previewSendTimerRef.current = setTimeout(() => {
      previewSendTimerRef.current = null
      const queued = previewSendQueuedRef.current
      previewSendQueuedRef.current = null
      if (queued) sendPreviewNow(queued.source, queued.elements)
    }, Math.max(0, PREVIEW_BROADCAST_INTERVAL_MS - elapsed))
  }, [sendPreviewNow])

  const applyRemotePreview = useCallback((value: unknown) => {
    if (statusRef.current !== 'Live' || !pageActiveRef.current) return
    const payload = parseCanvasPreviewPayload(value)
    if (!payload) { canvasDiagnostics.increment('previewBroadcastsRejected'); return }
    if (payload.deviceId === identityRef.current.deviceId) return
    if (!previewSequenceGateRef.current.accept(payload.deviceId, payload.sessionId, payload.sequence)) {
      canvasDiagnostics.increment('previewBroadcastsStale')
      return
    }

    const accepted: SceneElement[] = []
    const receivedPerfAt = performance.now()
    const receivedAt = Date.now()
    for (const candidate of payload.elements) {
      const element = elementFromPreview(candidate)
      if (!element) { canvasDiagnostics.increment('previewElementsRejected'); continue }
      const nextStamp = stampOf(element)
      if (!shouldRenderPreview(nextStamp, shadowRef.current.get(element.id), pendingRef.current.has(element.id))) continue
      const existing = remotePreviewRef.current.get(element.id)
      if (existing && !isNewerVersion(nextStamp, stampOf(existing.element))
        && !(sameVersionStamp(nextStamp, stampOf(existing.element)) && payload.sessionId === existing.sessionId && payload.sequence > existing.sequence)) continue
      const echoStamps = previewEchoStampsRef.current.get(element.id) ?? new Map<string, number>()
      echoStamps.set(previewStampKey(nextStamp), receivedAt + CANVAS_PREVIEW_TTL_MS + PREVIEW_ECHO_GRACE_MS)
      while (echoStamps.size > PREVIEW_ECHO_STAMPS_PER_ELEMENT) {
        const oldest = echoStamps.keys().next().value
        if (oldest === undefined) break
        echoStamps.delete(oldest)
      }
      previewEchoStampsRef.current.set(element.id, echoStamps)
      remotePreviewRef.current.set(element.id, {
        deviceId: payload.deviceId, sessionId: payload.sessionId, sequence: payload.sequence, receivedAt, expiresAt: receivedAt + CANVAS_PREVIEW_TTL_MS, element,
      })
      accepted.push(element)
    }
    if (!accepted.length) return
    const editor = apiRef.current
    if (!editor) return
    const reconciled = reconcileElements(
      editor.getSceneElementsIncludingDeleted() as Parameters<typeof reconcileElements>[0],
      accepted as unknown as Parameters<typeof reconcileElements>[1],
      editor.getAppState(),
    )
    applyingRemote.current = true
    editor.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER })
    queueMicrotask(() => { applyingRemote.current = false })
    canvasDiagnostics.increment('previewBroadcastsReceived')
    canvasDiagnostics.increment('previewElementsReceived', accepted.length)
    canvasDiagnostics.gauge('activeRemotePreviews', remotePreviewRef.current.size)
    requestAnimationFrame(() => canvasDiagnostics.sample('previewReceiveToFrameMs', performance.now() - receivedPerfAt))
  }, [])

  const captureCurrentScene = useCallback(() => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    // The editor model can be newer than its last React onChange callback.
    // Preserve that final gesture before pagehide/offline locks callbacks.
    // This only queues memory state; it never starts an unloading-page request.
    for (const element of editor.getSceneElementsIncludingDeleted()) {
      const recentPreviewEcho = (previewEchoStampsRef.current.get(element.id)?.get(previewStampKey(stampOf(element))) ?? 0) > Date.now()
      if (recentPreviewEcho) continue
      if (!isAllowedElement(element) || !isNewerVersion(stampOf(element), shadowRef.current.get(element.id))) continue
      const nextStamp = stampOf(element)
      const observed = observedSceneRef.current.get(element.id)
      if (isNewerVersion(nextStamp, observed)) {
        operationTracker.record(element, observed !== undefined)
        observedSceneRef.current.set(element.id, nextStamp)
      }
      const queued = pendingRef.current.get(element.id)
      if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
      const durable = durablePendingRef.current.get(element.id)
      if (!durable || isNewerVersion(nextStamp, stampOf(durable))) durablePendingRef.current.set(element.id, element)
    }
    canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
    continuousOperationRef.current = null
    clearCheckpointRef.current()
    operationTracker.flush()
  }, [operationTracker])

  useEffect(() => { identityRef.current = identity }, [identity])
  useEffect(() => { apiRef.current = api }, [api])
  useEffect(() => () => operationTracker.dispose(), [operationTracker])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      for (const [id, stamps] of previewEchoStampsRef.current) {
        for (const [key, expiresAt] of stamps) if (expiresAt <= now) stamps.delete(key)
        if (!stamps.size) previewEchoStampsRef.current.delete(id)
      }
      const expired: RemotePreview[] = []
      for (const [id, record] of remotePreviewRef.current) {
        if (record.expiresAt > now) continue
        remotePreviewRef.current.delete(id)
        expired.push(record)
      }
      if (!expired.length) return
      canvasDiagnostics.increment('previewExpirations', expired.length)
      canvasDiagnostics.gauge('activeRemotePreviews', remotePreviewRef.current.size)
      restoreRemotePreviews(expired)
    }, 200)
    return () => clearInterval(timer)
  }, [restoreRemotePreviews])
  useEffect(() => {
    commitPreviewRef.current = (source, elements) => queuePreview(source, elements, true)
    return () => { commitPreviewRef.current = () => {} }
  }, [queuePreview])
  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      if (statusRef.current !== 'Live' || editingTextRef.current) return
      const target = event.target
      if (!(target instanceof HTMLCanvasElement) || !target.matches('canvas.excalidraw__canvas.interactive')) return
      continuousOperationRef.current = 'pointer'
      operationTracker.beginPointer()
      armCheckpointRef.current()
    }
    const pointerEnd = () => {
      if (continuousOperationRef.current !== 'pointer') return
      continuousOperationRef.current = null
      clearCheckpointRef.current()
      operationTracker.endPointer()
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('pointerup', pointerEnd, true)
    document.addEventListener('pointercancel', pointerEnd, true)
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('pointerup', pointerEnd, true)
      document.removeEventListener('pointercancel', pointerEnd, true)
    }
  }, [operationTracker])
  useEffect(() => {
    pageActiveRef.current = true
    const hide = () => {
      clearRemotePreviews()
      captureCurrentScene()
      // Navigation may reject an outstanding save. Its recovery callback must
      // not start another fetch in the document that is being torn down.
      pageActiveRef.current = false
      transition(navigator.onLine ? 'Reconnecting' : 'Offline')
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
      if (checkpointTimer.current) { clearTimeout(checkpointTimer.current); checkpointTimer.current = null }
      if (previewSendTimerRef.current) { clearTimeout(previewSendTimerRef.current); previewSendTimerRef.current = null }
      previewSendQueuedRef.current = null
      setConnectionAttempt(value => value + 1)
    }
    const show = () => {
      if (pageActiveRef.current) return
      pageActiveRef.current = true
      retryDelayRef.current = 1200
      setConnectionAttempt(value => value + 1)
    }
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
      pageActiveRef.current = false
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
      if (checkpointTimer.current) { clearTimeout(checkpointTimer.current); checkpointTimer.current = null }
      if (previewSendTimerRef.current) { clearTimeout(previewSendTimerRef.current); previewSendTimerRef.current = null }
      previewSendQueuedRef.current = null
      clearRemotePreviews()
    }
  }, [captureCurrentScene, clearRemotePreviews, transition])
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme }, [resolvedTheme])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const offline = () => {
      clearRemotePreviews()
      captureCurrentScene()
      transition('Offline')
      setConnectionAttempt(value => value + 1)
    }
    const online = () => {
      transition('Reconnecting')
      retryDelayRef.current = 1200
      setConnectionAttempt(value => value + 1)
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [captureCurrentScene, clearRemotePreviews, transition])

  const applyRows = useCallback((values: unknown[], replace = false) => {
    const editor = apiRef.current
    if (!editor || !pageActiveRef.current) return
    const rows = values.map(normalizeRow).filter((row): row is SyncRow => row !== null)
    const localElements = replace ? [] : editor.getSceneElementsIncludingDeleted()
    const remoteElements: SceneElement[] = []
    if (replace) {
      shadowRef.current.clear()
      authoritativeElementsRef.current.clear()
      observedSceneRef.current.clear()
      remotePreviewRef.current.clear()
      previewEchoStampsRef.current.clear()
      previewSequenceGateRef.current.clear()
      canvasDiagnostics.gauge('activeRemotePreviews', 0)
    }
    let changed = replace

    for (const row of rows) {
      const element = elementFromRow(row)
      if (!element) continue
      const nextStamp = { version: row.version, versionNonce: row.version_nonce, isDeleted: row.is_deleted }
      const previousAuthority = authoritativeElementsRef.current.get(row.id)
      if (replace || !previousAuthority || isNewerVersion(nextStamp, stampOf(previousAuthority))) authoritativeElementsRef.current.set(row.id, element)
      const activePreview = remotePreviewRef.current.get(row.id)
      if (activePreview && !isNewerVersion(stampOf(activePreview.element), nextStamp)) {
        remotePreviewRef.current.delete(row.id)
        canvasDiagnostics.gauge('activeRemotePreviews', remotePreviewRef.current.size)
      }
      const pending = pendingRef.current.get(row.id)
      const durablePending = durablePendingRef.current.get(row.id)

      // Keep the operation observer aligned with authoritative remote state, but
      // never move it backwards over a newer local element still awaiting ACK.
      const observed = observedSceneRef.current.get(row.id)
      if (replace || isNewerVersion(nextStamp, observed)) observedSceneRef.current.set(row.id, nextStamp)

      // Equal or losing pending work has been accepted/superseded and must not
      // survive merely because this authoritative row was already observed.
      if (pending && !shouldKeepPending(stampOf(pending), nextStamp)) pendingRef.current.delete(row.id)
      if (durablePending && !shouldKeepPending(stampOf(durablePending), nextStamp)) durablePendingRef.current.delete(row.id)
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)

      if (!replace && !isNewerVersion(nextStamp, shadowRef.current.get(row.id))) continue

      const survivingPreview = remotePreviewRef.current.get(row.id)
      if (!replace && survivingPreview && isNewerVersion(stampOf(survivingPreview.element), nextStamp)) {
        shadowRef.current.set(row.id, nextStamp)
        continue
      }

      // A row that exactly acknowledges the immutable Excalidraw version already
      // rendered locally only needs to advance the authoritative watermark.
      // Reapplying that same element through updateScene can make Excalidraw emit
      // a follow-up version and turn a server ACK into a second local mutation.
      if (!replace) {
        const currentLocal = localElements.find(candidate => candidate.id === row.id)
        if (currentLocal) {
          const currentStamp = stampOf(currentLocal)
          if (currentStamp.version === nextStamp.version
            && currentStamp.versionNonce === nextStamp.versionNonce
            && currentStamp.isDeleted === nextStamp.isDeleted) {
            shadowRef.current.set(row.id, nextStamp)
            continue
          }
        }
      }

      const survivingPending = pendingRef.current.get(row.id)
      if (!replace && survivingPending && shouldKeepPending(stampOf(survivingPending), nextStamp)) {
        shadowRef.current.set(row.id, nextStamp)
        continue
      }

      shadowRef.current.set(row.id, nextStamp)
      remoteElements.push(element)
      changed = true
    }

    if (!changed) return
    const reconciled = reconcileElements(
      localElements as Parameters<typeof reconcileElements>[0],
      remoteElements as unknown as Parameters<typeof reconcileElements>[1],
      editor.getAppState(),
    )
    applyingRemote.current = true
    editor.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER })
    queueMicrotask(() => { applyingRemote.current = false })
  }, [])

  const loadAuthoritative = useCallback(async (isCurrent: () => boolean = () => true, mode: 'initial' | 'reconcile' = 'initial') => {
    if (!pageActiveRef.current) return
    const startedAt = performance.now()
    const startAfter = mode === 'reconcile' ? reconciliationCursorRef.current : 0
    let firstPage = true
    const result = await readRevisionPages<SyncRow>({
      startAfter,
      pageSize: ANTI_ENTROPY_PAGE_SIZE,
      isCurrent,
      fetchPage: async (afterRevision, limit) => {
        const { data, error } = await supabase.from(config.tableName)
          .select('id,version,version_nonce,is_deleted,element,revision')
          .gt('revision', afterRevision)
          .order('revision', { ascending: true })
          .limit(limit)
          .abortSignal(AbortSignal.timeout(15_000))
        if (error) throw error
        return (data ?? []).map(normalizeRow).filter((row): row is SyncRow => row !== null)
      },
      onPage: rows => {
        if (!isCurrent()) return
        applyRows(rows, mode === 'initial' && firstPage && pendingRef.current.size === 0)
        firstPage = false
      },
    })
    if (!result.completed || !isCurrent()) return
    reconciliationCursorRef.current = result.cursor
    canvasDiagnostics.gauge('reconciliationCursor', result.cursor)
    if (mode === 'reconcile') {
      canvasDiagnostics.increment('antiEntropyRowsRead', result.rows)
      canvasDiagnostics.sample('antiEntropyMs', performance.now() - startedAt)
    }
  }, [applyRows, config.tableName, supabase])

  const reconcileAuthoritative = useCallback(async () => {
    if (reconciliationInFlightRef.current || !pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || continuousOperationRef.current) return
    reconciliationInFlightRef.current = true
    canvasDiagnostics.increment('antiEntropyRuns')
    try {
      await loadAuthoritative(() => pageActiveRef.current && statusRef.current === 'Live' && navigator.onLine, 'reconcile')
      canvasDiagnostics.increment('antiEntropySuccesses')
    } catch {
      canvasDiagnostics.increment('antiEntropyFailures')
    } finally {
      reconciliationInFlightRef.current = false
    }
  }, [loadAuthoritative])

  const flushDurablePending = useCallback(async () => {
    if (writeInFlightRef.current || !pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || durablePendingRef.current.size === 0) return
    writeInFlightRef.current = true
    const elements = Array.from(durablePendingRef.current.values())
    durablePendingRef.current.clear()
    canvasDiagnostics.gauge('durableQueueElements', 0)
    try {
      const rows = elements.map(element => ({
        id: element.id,
        version: element.version,
        version_nonce: element.versionNonce,
        is_deleted: element.isDeleted,
        element,
        updated_by: identityRef.current.deviceId,
      }))
      const ids = rows.map(row => row.id)
      const { error } = await supabase.from(config.tableName).upsert(rows, { onConflict: 'id' })
      if (error) {
        for (const element of elements) {
          const queued = durablePendingRef.current.get(element.id)
          if (!queued || isNewerVersion(stampOf(element), stampOf(queued))) durablePendingRef.current.set(element.id, element)
        }
        canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
        if (!pageActiveRef.current) return
        if (!navigator.onLine) transition('Offline')
        notify(`Canvas could not save: ${error.message}`)
        if (navigator.onLine) {
          try {
            await loadAuthoritative()
          } catch {
            // Keep the durable queue intact. The bounded retry below will try again.
          }
        }
        if (pageActiveRef.current && navigator.onLine && durablePendingRef.current.size && !flushTimer.current) {
          flushTimer.current = setTimeout(() => { flushTimer.current = null; void flushDurablePending() }, 1200)
        }
        return
      }
      if (!pageActiveRef.current) return
      const { data, error: readError } = await supabase.from(config.tableName).select('id,version,version_nonce,is_deleted,element,revision').in('id', ids)
      if (!pageActiveRef.current) return
      if (readError) {
        notify(`Canvas saved, but could not confirm the latest state: ${readError.message}`)
        return
      }
      applyRows(data ?? [])
    } catch (error) {
      // Supabase normally reports write failures through the returned `error`
      // object, but a transport/runtime failure can reject the request instead.
      // Requeue the exact attempted versions so a thrown failure cannot drop a
      // completed mutation between the durability boundary and retry.
      for (const element of elements) {
        const queued = durablePendingRef.current.get(element.id)
        if (!queued || isNewerVersion(stampOf(element), stampOf(queued))) durablePendingRef.current.set(element.id, element)
      }
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
      if (pageActiveRef.current) {
        if (!navigator.onLine) transition('Offline')
        const message = error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error)
        notify(`Canvas could not save: ${message}`)
        if (navigator.onLine) {
          try {
            await loadAuthoritative()
          } catch {
            // Keep the durable queue intact. The retry scheduled below owns recovery.
          }
        }
        if (navigator.onLine && durablePendingRef.current.size && !flushTimer.current) {
          flushTimer.current = setTimeout(() => { flushTimer.current = null; void flushDurablePending() }, 1200)
        }
      }
    } finally {
      writeInFlightRef.current = false
      if (pageActiveRef.current && statusRef.current === 'Live' && navigator.onLine && durablePendingRef.current.size && !flushTimer.current) {
        flushTimer.current = setTimeout(() => { flushTimer.current = null; void flushDurablePending() }, OPERATION_FLUSH_DELAY_MS)
      }
    }
  }, [applyRows, config.tableName, loadAuthoritative, notify, supabase, transition])

  const scheduleFlush = useCallback((delayMs = RECONNECT_FLUSH_DELAY_MS) => {
    if (!pageActiveRef.current || flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      void flushDurablePending()
    }, delayMs)
  }, [flushDurablePending])

  const clearLongOperationCheckpoint = useCallback(() => {
    if (!checkpointTimer.current) return
    clearTimeout(checkpointTimer.current)
    checkpointTimer.current = null
  }, [])

  const armLongOperationCheckpoint = useCallback(() => {
    clearLongOperationCheckpoint()
    const checkpoint = () => {
      checkpointTimer.current = null
      if (!pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || !continuousOperationRef.current) return
      const snapshot = operationTracker.snapshotActive()
      if (snapshot) {
        let checkpointQueued = false
        for (const change of snapshot.changes) {
          const element = change.type === 'delete' ? change.tombstone : change.element
          const nextStamp = stampOf(element)
          if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
          const queued = durablePendingRef.current.get(element.id)
          if (!queued || isNewerVersion(nextStamp, stampOf(queued))) {
            durablePendingRef.current.set(element.id, element)
            checkpointQueued = true
          }
        }
        if (checkpointQueued) {
          canvasDiagnostics.increment('durabilityCheckpoints')
          canvasDiagnostics.gauge('lastDurabilityCheckpointSource', snapshot.source)
          canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
          void flushDurablePending()
        }
      }
      if (continuousOperationRef.current) checkpointTimer.current = setTimeout(checkpoint, LONG_OPERATION_CHECKPOINT_MS)
    }
    checkpointTimer.current = setTimeout(checkpoint, LONG_OPERATION_CHECKPOINT_MS)
  }, [clearLongOperationCheckpoint, flushDurablePending, operationTracker])

  useEffect(() => {
    durabilityCommitRef.current = () => {
      clearLongOperationCheckpoint()
      if (!durablePendingRef.current.size) return
      canvasDiagnostics.increment('durabilityBoundaryFlushes')
      scheduleFlush(OPERATION_FLUSH_DELAY_MS)
    }
    armCheckpointRef.current = armLongOperationCheckpoint
    clearCheckpointRef.current = clearLongOperationCheckpoint
    return () => {
      durabilityCommitRef.current = () => {}
      armCheckpointRef.current = () => {}
      clearCheckpointRef.current = () => {}
      clearLongOperationCheckpoint()
    }
  }, [armLongOperationCheckpoint, clearLongOperationCheckpoint, scheduleFlush])

  useEffect(() => {
    if (status === 'Live' && durablePendingRef.current.size && !continuousOperationRef.current) scheduleFlush()
  }, [scheduleFlush, status])

  const syncPresence = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>
    const active = new Map<string, PresencePerson>()
    for (const [presenceKey, metas] of Object.entries(state)) {
      const meta = metas.at(-1)
      if (!meta) continue
      const deviceId = typeof meta.deviceId === 'string' ? meta.deviceId : presenceKey
      if (!deviceId || deviceId === identityRef.current.deviceId) continue
      const person = {
        deviceId,
        displayName: cleanName(typeof meta.displayName === 'string' ? meta.displayName : 'Guest'),
        color: typeof meta.color === 'string' ? safeColor(meta.color) : '#666666',
      }
      active.set(deviceId, person)
      const socketId = deviceId as SocketId
      const existing = collaboratorsRef.current.get(socketId)
      collaboratorsRef.current.set(socketId, { ...existing, username: person.displayName } as Collaborator)
    }
    for (const socketId of collaboratorsRef.current.keys()) {
      if (!active.has(socketId as string)) collaboratorsRef.current.delete(socketId)
    }
    setPeople(Array.from(active.values()).sort((a, b) => a.displayName.localeCompare(b.displayName)))
    apiRef.current?.updateScene({ collaborators: new Map(collaboratorsRef.current) })
  }, [])

  useEffect(() => {
    if (!api) return
    let disposed = false
    let channel: RealtimeChannel | null = null
    let syncGeneration = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const retry = () => {
      if (disposed || !pageActiveRef.current || retryTimer || !navigator.onLine) return
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, 10_000)
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!disposed && pageActiveRef.current) setConnectionAttempt(value => value + 1)
      }, delay)
    }
    const start = async () => {
      // Removing a channel is asynchronous. Do not reuse a same-topic channel
      // while its predecessor is still leaving (including StrictMode cleanup).
      await channelCleanupRef.current
      if (disposed || !pageActiveRef.current) return
      if (!navigator.onLine) { transition('Offline'); return }
      transition(connectionAttempt ? 'Reconnecting' : 'Connecting')
      collaboratorsRef.current.clear()
      setPeople([])
      api.updateScene({ collaborators: new Map() })
      const currentChannel = supabase.channel(`canvas:${config.tableName}:v1`, { config: { presence: { key: identity.deviceId }, broadcast: { self: false } } })
      channel = currentChannel
      channelRef.current = currentChannel
      const isCurrent = () => !disposed && pageActiveRef.current && navigator.onLine && channelRef.current === currentChannel
      currentChannel
        .on('postgres_changes', { event: '*', schema: 'public', table: config.tableName }, payload => {
          if (!isCurrent() || !payload.new || !Object.keys(payload.new).length) return
          if (dropRealtimeForDiagnosticsRef.current) {
            canvasDiagnostics.increment('realtimeChangesDroppedForDiagnostics')
            return
          }
          applyRows([payload.new])
        })
        .on('presence', { event: 'sync' }, () => { if (isCurrent()) syncPresence(currentChannel) })
        .on('broadcast', { event: 'preview' }, message => {
          if (isCurrent()) applyRemotePreview(message.payload)
        })
        .on('broadcast', { event: 'cursor' }, message => {
          if (!isCurrent()) return
          const payload = message.payload as Partial<CursorPayload>
          if (!payload.deviceId || payload.deviceId === identityRef.current.deviceId || !payload.pointer) return
          if (typeof payload.pointer.x !== 'number' || typeof payload.pointer.y !== 'number') return
          const socketId = payload.deviceId as SocketId
          const existing = collaboratorsRef.current.get(socketId)
          collaboratorsRef.current.set(socketId, {
            ...existing,
            username: cleanName(payload.displayName ?? 'Guest'),
            pointer: { x: payload.pointer.x, y: payload.pointer.y, tool: payload.pointer.tool === 'laser' ? 'laser' : 'pointer' },
            button: payload.button === 'down' ? 'down' : 'up',
            selectedElementIds: payload.selectedElementIds && typeof payload.selectedElementIds === 'object' ? payload.selectedElementIds : {},
          } as Collaborator)
          apiRef.current?.updateScene({ collaborators: new Map(collaboratorsRef.current) })
        })
        .subscribe(subscriptionStatus => {
          if (disposed || !pageActiveRef.current) return
          if (subscriptionStatus === 'SUBSCRIBED') {
            const generation = ++syncGeneration
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
            if (!isCurrent()) return
            transition('Synchronizing')
            // Presence is ephemeral. An unavailable presence acknowledgement must
            // not prevent a successfully joined client from loading durable data.
            void currentChannel.track({ deviceId: identityRef.current.deviceId, displayName: identityRef.current.displayName, color: identityRef.current.color, onlineAt: new Date().toISOString() }).catch(() => {})
            const stillCurrent = () => isCurrent() && generation === syncGeneration
            void loadAuthoritative(stillCurrent)
              .then(() => {
                if (!stillCurrent()) return
                retryDelayRef.current = 1200
                transition('Live')
                if (durablePendingRef.current.size) scheduleFlush()
              })
              .catch(error => {
                if (!stillCurrent()) return
                transition('Error')
                notify(`Canvas could not synchronize: ${error instanceof Error ? error.message : String(error)}`)
                retry()
              })
          } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT' || subscriptionStatus === 'CLOSED') {
            ++syncGeneration
            transition(navigator.onLine ? 'Reconnecting' : 'Offline')
            retry()
          }
        })
    }
    void start().catch(error => {
      if (disposed || !pageActiveRef.current) return
      transition(navigator.onLine ? 'Error' : 'Offline')
      notify(`Canvas could not connect: ${error instanceof Error ? error.message : String(error)}`)
      retry()
    })
    return () => {
      disposed = true
      ++syncGeneration
      if (retryTimer) clearTimeout(retryTimer)
      if (channel) {
        clearRemotePreviews()
        if (channelRef.current === channel) channelRef.current = null
        channelCleanupRef.current = supabase.removeChannel(channel).catch(() => {})
      }
    }
  }, [api, applyRemotePreview, applyRows, clearRemotePreviews, config.tableName, connectionAttempt, identity.deviceId, loadAuthoritative, notify, scheduleFlush, supabase, syncPresence, transition])

  useEffect(() => {
    if (status !== 'Live') return
    const requestReconciliation = () => {
      if (document.visibilityState === 'visible') void reconcileAuthoritative()
    }
    const timer = window.setInterval(requestReconciliation, ANTI_ENTROPY_INTERVAL_MS)
    window.addEventListener('focus', requestReconciliation)
    document.addEventListener('visibilitychange', requestReconciliation)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', requestReconciliation)
      document.removeEventListener('visibilitychange', requestReconciliation)
    }
  }, [reconcileAuthoritative, status])

  useEffect(() => {
    const channel = channelRef.current
    if (!pageActiveRef.current || !channel || (status !== 'Live' && status !== 'Synchronizing')) return
    void channel.track({ deviceId: identity.deviceId, displayName: identity.displayName, color: identity.color, onlineAt: new Date().toISOString() }).catch(() => {})
  }, [identity, status])

  const onChange = useCallback((elements: readonly SceneElement[], appState: AppState) => {
    if (applyingRemote.current || statusRef.current !== 'Live') return
    const previousEditingTextId = editingTextRef.current
    const nextEditingTextId = appState.editingTextElement?.id ?? null
    if (nextEditingTextId && nextEditingTextId !== previousEditingTextId) {
      if (previousEditingTextId) operationTracker.endText()
      continuousOperationRef.current = 'text'
      operationTracker.beginText()
      armCheckpointRef.current()
    }
    const allowed = elements.filter(isAllowedElement)
    if (allowed.length !== elements.length) {
      notify('Images, embeds, and file-backed objects are disabled on this canvas.')
      applyingRemote.current = true
      apiRef.current?.updateScene({ elements: allowed, captureUpdate: CaptureUpdateAction.NEVER })
      queueMicrotask(() => { applyingRemote.current = false })
    }
    for (const element of allowed) {
      const nextStamp = stampOf(element)
      const previewEchoExpiresAt = previewEchoStampsRef.current.get(element.id)?.get(previewStampKey(nextStamp)) ?? 0
      // A preview can emit onChange after updateScene's synchronous guard clears,
      // and an older preview callback can arrive after a newer preview packet.
      // Exact recently rendered preview versions are therefore quarantined.
      if (previewEchoExpiresAt > Date.now()) {
        canvasDiagnostics.increment('previewEchoesSuppressed')
        continue
      }
      const observed = observedSceneRef.current.get(element.id)
      if (isNewerVersion(nextStamp, observed)) {
        operationTracker.record(element, observed !== undefined)
        observedSceneRef.current.set(element.id, nextStamp)
      }

      // Keep intermediate local states in memory so remote echoes cannot
      // clobber an active gesture. Phase 3 changes the durability boundary, not
      // this conflict-protection watermark: network persistence starts only
      // when the logical CanvasMutation commits (or at a long-op checkpoint).
      if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
      const queued = pendingRef.current.get(element.id)
      if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
    }
    const activeSnapshot = operationTracker.snapshotActive()
    if (activeSnapshot && (activeSnapshot.source === 'pointer' || activeSnapshot.source === 'text')) {
      queuePreview(activeSnapshot.source, activeSnapshot.changes.map(change => change.type === 'delete' ? change.tombstone : change.element))
    }
    if (previousEditingTextId && !nextEditingTextId) {
      continuousOperationRef.current = null
      clearCheckpointRef.current()
      operationTracker.endText()
    }
    editingTextRef.current = nextEditingTextId
  }, [notify, operationTracker, queuePreview])

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'up' | 'down' }) => {
    if (statusRef.current !== 'Live') return
    const now = performance.now()
    if (now - cursorAt.current < 45 && payload.button !== 'down') return
    cursorAt.current = now
    const channel = channelRef.current
    if (!channel) return
    const selectedElementIds = apiRef.current?.getAppState().selectedElementIds ?? {}
    void channel.send({ type: 'broadcast', event: 'cursor', payload: { deviceId: identityRef.current.deviceId, displayName: identityRef.current.displayName, pointer: payload.pointer, button: payload.button, selectedElementIds } satisfies CursorPayload })
  }, [])

  const rename = (value: string) => {
    const next = { ...identity, displayName: cleanName(value) }
    setIdentity(next)
    if (!saveIdentity(storage, next)) notify('Browser storage is unavailable. This name lasts until the tab closes.')
  }
  const changeTheme = (next: ThemePreference) => { setTheme(next); writePreference(storage, 'canvas.theme.v1', next) }
  const blockPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const hasFile = Array.from(event.clipboardData.items).some(item => item.kind === 'file')
    if (!hasFile) return
    event.preventDefault(); event.stopPropagation(); notify('Images and files are disabled. Paste text instead.')
  }
  const blockDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault(); event.stopPropagation(); notify('File uploads are disabled on Canvas.')
  }

  return <div className="canvas-app live-canvas-app" data-canvas-engine="excalidraw-supabase">
    <LiveHeader api={api} identity={identity} people={people} status={status} theme={theme} rename={rename} changeTheme={changeTheme} />
    <main className="canvas-workspace live-canvas-workspace" aria-label="Shared infinite canvas">
      <div className="live-excalidraw" onPasteCapture={blockPaste} onDropCapture={blockDrop} onDragOverCapture={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}>
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          theme={resolvedTheme}
          viewModeEnabled={status !== 'Live'}
          isCollaborating={status === 'Live'}
          UIOptions={UI_OPTIONS}
          aiEnabled={false}
          name="Canvas"
          langCode="en"
        >
          <MainMenu />
          <DefaultSidebar.Trigger style={{ display: 'none' }} aria-hidden="true" />
        </Excalidraw>
      </div>
      {status !== 'Live' && <div className="network-banner" role="status">{status === 'Error' ? 'Canvas could not synchronize. Retrying automatically; editing remains paused.' : `${status} — editing is paused until the shared canvas is synchronized.`}</div>}
      {notice && <div className="canvas-notice" role="status">{notice}</div>}
    </main>
  </div>
}
