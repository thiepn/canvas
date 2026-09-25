import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { CaptureUpdateAction, DefaultSidebar, Excalidraw, MainMenu, convertToExcalidrawElements, newElementWith, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, BinaryFileData, BinaryFiles, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { Icon } from '../components/Icon.tsx'
import { browserStorage, cleanName, loadIdentity, saveIdentity, type Identity, type LocalStorageLike } from '../presence/identity.ts'
import { loadTheme, readPreference, writePreference, type ThemePreference } from '../storage/preferences.ts'
import type { LiveConfig } from '../config/public-config.ts'
import { recordMutationDiagnostics } from '../diagnostics/operations.ts'
import { canvasDiagnostics } from '../diagnostics/metrics.ts'
import { CanvasOperationTracker } from './operation-model.ts'
import { readRevisionPages } from './revision-sync.ts'
import { SceneVersionIndex, indexSceneById } from './scene-index.ts'
import {
  clearRecoveryJournal,
  readRecoveryJournal,
  recoveryCandidates,
  writeRecoveryJournal,
  type RecoveryElement,
} from './recovery-journal.ts'
import { deriveSyncHealth, recoveryMessage, saveIssueAfterDurableAttempt, type CanvasConnectionState, type SaveIssue, type SyncHealth } from './sync-health.ts'
import { enforceAuthoritativeTombstones, isNewerVersion, shouldApplyAuthoritativeChange, shouldKeepPending, type VersionStamp } from './sync-version.ts'
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
import { createRichTextElement, RichTextLayer, type RichTextLayerHandle } from './rich-text.tsx'
import { SelectionToolbar, unlockAllElements, type CanvasSelectionSnapshot } from './SelectionToolbar.tsx'
import { CanvasShapeLayer, createCanvasShapeElement, type CanvasShapeKind, type CanvasShapeLayerHandle } from './canvas-shapes.tsx'
import { DrawingControls, type DrawingControlSettings } from './DrawingControls.tsx'
import {
  eraseFreeDrawWithPath,
  finalizeFreeDrawElement,
  isAccidentalTinyStroke,
  recognizeHeldStroke,
  type DrawingElementLike,
  type DrawingMode,
  type ScenePoint,
} from './drawing-tools.ts'
import { reorderSelection, type CanvasElementLike } from './selection-tools.ts'
import { NavigationOverlay, type NavigationOverlayHandle } from './NavigationOverlay.tsx'
import { CanvasBackdrop, type CanvasBackdropHandle } from './CanvasBackdrop.tsx'
import { VisualControls } from './VisualControls.tsx'
import {
  accentColor,
  loadVisualProfile,
  performHaptic,
  performTone,
  resolveCanvasMotion,
  saveVisualProfile,
  visualRootStyle,
  type CanvasVisualProfile,
} from './visual-system.ts'
import { CollaborationOverlay } from './CollaborationOverlay.tsx'
import { CollaborationPanel } from './CollaborationPanel.tsx'
import {
  COLLABORATION_IDLE_POINTER_AFTER_MS,
  COLLABORATION_REACTION_TTL_MS,
  CollaborationSequenceGate,
  createCollaborationEffectPayload,
  createCollaborationStatePayload,
  followerViewport,
  isStaleCollaborationPayload,
  parseCollaborationEffectPayload,
  parseCollaborationStatePayload,
  viewportCenter,
  type CollaborationActivity,
  type CollaborationEffectPayload,
  type CollaborationEffectView,
  type CollaborationReaction,
  type CollaborationViewport,
  type RemoteCollaborationState,
} from './collaboration-v2.ts'
import { canUndoOwnAction, restoreOwnActionElement, type OwnUndoEntry } from './own-action-undo.ts'
import { MediaControls, type CanvasExportFormat } from './MediaControls.tsx'
import { BoundedTaskQueue } from './bounded-task-queue.ts'
import {
  assetBucketForTable,
  generateCanvasFileId,
  isPersistableCanvasElement,
  isSafeCanvasLink,
  isSupportedImageMime,
  referencedAssetIds,
} from './media-assets.ts'
import {
  createBookmarkCard,
  createCanvasClipboardText,
  createCanvasImage,
  downloadCanvasAsset,
  exportCanvasScene,
  insertElements,
  isCanvasClipboardText,
  markImagesErrored,
  markImagesSaved,
  prepareCanvasJsonImport,
  uploadCanvasAsset,
} from './media-runtime.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]
type ConnectionState = CanvasConnectionState
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
type SyncRuntimeState = { queuedChanges: number; writeInFlight: boolean; assetTransfers: number; localEditing: boolean; saveIssue: SaveIssue }

const ALLOWED_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'frame', 'image'])
const OPERATION_FLUSH_DELAY_MS = 0
const RECONNECT_FLUSH_DELAY_MS = 120
const DURABLE_REQUEST_TIMEOUT_MS = 8_000
const LONG_OPERATION_CHECKPOINT_MS = 1500
const PREVIEW_BROADCAST_INTERVAL_MS = 45
const PREVIEW_ECHO_GRACE_MS = 1000
const PREVIEW_ECHO_STAMPS_PER_ELEMENT = 16
const ANTI_ENTROPY_PAGE_SIZE = 500
const ANTI_ENTROPY_INTERVAL_MS = 15_000
const COLLABORATION_BROADCAST_INTERVAL_MS = 50
const COLLABORATION_HEARTBEAT_MS = 5_000
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
  tools: { image: true },
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
  if (!isSafeCanvasLink(element.link)) return null
  if (!isPersistableCanvasElement(element as unknown as SceneElement)) return null
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
  if (!isPersistableCanvasElement(value as unknown as SceneElement)) return null
  if (![raw.x, raw.y, raw.width, raw.height, raw.angle].every(finiteCoordinate)) return null
  if ((raw.type === 'line' || raw.type === 'arrow' || raw.type === 'freedraw') && !hasSafePoints(raw.points)) return null
  if (raw.type === 'text' && (typeof raw.text !== 'string' || raw.text.length > 200_000)) return null
  if (!isSafeCanvasLink(raw.link)) return null
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

function drawingNumberPreference(storage: LocalStorageLike | null, key: string, fallback: number, min: number, max: number): number {
  const value = Number(readPreference(storage, key))
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function drawingBooleanPreference(storage: LocalStorageLike | null, key: string, fallback: boolean): boolean {
  const value = readPreference(storage, key)
  return value === null ? fallback : value === 'true'
}

function drawingColorPreference(storage: LocalStorageLike | null, key: string, fallback: string): string {
  const value = readPreference(storage, key)
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function downloadBackup(api: ExcalidrawImperativeAPI | null) {
  if (!api) return
  void exportCanvasScene(api, 'json').catch(() => {})
}

function LiveHeader({ api, identity, people, status, syncHealth, theme, rename, changeTheme, richTextMode, toggleRichText, hasLockedElements, unlockAll, insertCustomShape, drawingControls, collaborationPanel, mediaControls, visualControls, deactivateDrawing }: {
  api: ExcalidrawImperativeAPI | null
  identity: Identity
  people: PresencePerson[]
  status: ConnectionState
  syncHealth: SyncHealth
  theme: ThemePreference
  rename: (name: string) => void
  changeTheme: (theme: ThemePreference) => void
  richTextMode: boolean
  toggleRichText: () => void
  hasLockedElements: boolean
  unlockAll: () => void
  insertCustomShape: (kind: CanvasShapeKind) => void
  drawingControls: ReactNode
  collaborationPanel: ReactNode
  mediaControls: ReactNode
  visualControls: ReactNode
  deactivateDrawing: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [shapeMenu, setShapeMenu] = useState(false)
  const [name, setName] = useState(identity.displayName)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shapeMenuRef = useRef<HTMLDivElement>(null)
  const shapeTriggerRef = useRef<HTMLButtonElement>(null)
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
  useEffect(() => {
    if (!shapeMenu) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShapeMenu(false); shapeTriggerRef.current?.focus() }
    }
    const pointerdown = (event: PointerEvent) => {
      if (!shapeMenuRef.current?.contains(event.target as Node) && !shapeTriggerRef.current?.contains(event.target as Node)) setShapeMenu(false)
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('pointerdown', pointerdown)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('pointerdown', pointerdown)
    }
  }, [shapeMenu])
  const submit = (event: FormEvent) => { event.preventDefault(); rename(name); setMenu(false); triggerRef.current?.focus() }
  const fit = () => {
    const elements = api?.getSceneElements() ?? []
    if (api && elements.length) api.scrollToContent(elements, { fitToViewport: true, animate: true })
  }
  const activateFrame = () => {
    if (!api || status !== 'Live') return
    deactivateDrawing()
    api.setActiveTool({ type: 'frame' })
    setMenu(false)
  }
  const activateNativeShape = (type: 'rectangle' | 'ellipse' | 'diamond') => {
    if (!api || status !== 'Live') return
    deactivateDrawing()
    api.setActiveTool({ type })
    setShapeMenu(false)
  }
  const addCustomShape = (kind: CanvasShapeKind) => {
    insertCustomShape(kind)
    setShapeMenu(false)
  }
  return <header className="canvas-header live-canvas-header">
    <h1>Canvas<span className="brand-period" aria-hidden="true">.</span></h1>
    <div role="status" aria-live="polite" aria-atomic="true" data-sync-health={syncHealth.key} data-connection-state={status.toLowerCase()} className={`connection sync-health sync-health--${syncHealth.tone}`} aria-label={`${syncHealth.label}. ${syncHealth.detail}${status === 'Live' ? ' Live connection.' : ''}`} title={syncHealth.detail}><span aria-hidden="true" /><span>{syncHealth.label}</span>{status === 'Live' && <span className="connection-transport">Live</span>}</div>
    <div className="header-spacer" />
    <div className="people-peek" aria-label={status === 'Live' ? `${people.length + 1} people connected` : 'No active connection'}>{status === 'Live' && people.slice(0, 3).map(person => <span key={person.deviceId} title={person.displayName} className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />)}</div>
    {visualControls}
    {mediaControls}
    {drawingControls}
    <button ref={shapeTriggerRef} type="button" className={`icon-button shape-library-button${shapeMenu ? ' is-active' : ''}`} aria-label="Shape library" aria-expanded={shapeMenu} title="Shape library" disabled={!api || status !== 'Live'} onClick={() => setShapeMenu(value => !value)}><Icon name="rectangle" /></button>
    {shapeMenu && <div ref={shapeMenuRef} className="shape-library-popover" aria-label="Shape library menu">
      <div className="shape-library-heading">SHAPES</div>
      <div className="shape-library-grid">
        <button type="button" onClick={() => activateNativeShape('rectangle')}><span className="shape-preview shape-preview--rectangle" />Rectangle</button>
        <button type="button" onClick={() => activateNativeShape('ellipse')}><span className="shape-preview shape-preview--ellipse" />Ellipse</button>
        <button type="button" onClick={() => activateNativeShape('diamond')}><span className="shape-preview shape-preview--diamond" />Diamond</button>
        <button type="button" onClick={() => addCustomShape('rounded-rectangle')}><span className="shape-preview shape-preview--rounded" />Rounded</button>
        <button type="button" onClick={() => addCustomShape('triangle')}><span className="shape-preview shape-preview--triangle" />Triangle</button>
        <button type="button" onClick={() => addCustomShape('polygon')}><span className="shape-preview shape-preview--polygon" />Polygon</button>
        <button type="button" onClick={() => addCustomShape('hexagon')}><span className="shape-preview shape-preview--hexagon" />Hexagon</button>
        <button type="button" onClick={() => addCustomShape('star')}><span className="shape-preview shape-preview--star">★</span>Star</button>
        <button type="button" onClick={() => addCustomShape('speech-bubble')}><span className="shape-preview shape-preview--bubble" />Speech</button>
        <button type="button" onClick={() => addCustomShape('cloud')}><span className="shape-preview shape-preview--cloud">☁</span>Cloud</button>
      </div>
      <div className="shape-library-heading shape-library-stamps-heading">STAMPS</div>
      <div className="shape-library-grid shape-library-stamp-grid">
        <button type="button" onClick={() => addCustomShape('heart')}><span className="stamp-preview" aria-hidden="true">♥</span>Heart</button>
        <button type="button" onClick={() => addCustomShape('check')}><span className="stamp-preview" aria-hidden="true">✓</span>Check</button>
        <button type="button" onClick={() => addCustomShape('sparkle')}><span className="stamp-preview" aria-hidden="true">✦</span>Sparkle</button>
        <button type="button" onClick={() => addCustomShape('pin')}><span className="stamp-preview" aria-hidden="true">●</span>Pin</button>
        <button type="button" onClick={() => addCustomShape('flag')}><span className="stamp-preview" aria-hidden="true">⚑</span>Flag</button>
        <button type="button" onClick={() => addCustomShape('bolt')}><span className="stamp-preview" aria-hidden="true">ϟ</span>Bolt</button>
      </div>
    </div>}
    <button type="button" className={`icon-button rich-text-button${richTextMode ? ' is-active' : ''}`} aria-label="Rich text" aria-pressed={richTextMode} title="Rich text (T)" disabled={!api || status !== 'Live'} onClick={toggleRichText}><Icon name="text" /></button>
    <button type="button" className="icon-button frame-button" aria-label="Frame tool" title="Frame tool" disabled={!api || status !== 'Live'} onClick={activateFrame}><Icon name="frame" /></button>
    <button type="button" className="icon-button fit-button" aria-label="Fit content" title="Fit all content" disabled={!api} onClick={fit}><Icon name="fit" /></button>
    <button ref={triggerRef} type="button" className="identity-trigger" aria-label="Canvas menu and presence" aria-expanded={menu} aria-controls={menu ? 'live-canvas-menu' : undefined} onClick={() => setMenu(!menu)}><span className="identity-initial" style={{ borderColor: safeColor(identity.color) }}>{identity.displayName.slice(0, 1).toUpperCase()}</span><span className="identity-name">{identity.displayName}</span><Icon name="more" /></button>
    {menu && <div ref={menuRef} id="live-canvas-menu" className="canvas-menu" aria-label="Canvas settings">
      <div className="menu-heading">ON THIS CANVAS</div>
      <div className="people-list"><div><span className="presence-dot" style={{ backgroundColor: safeColor(identity.color) }} />{identity.displayName}<small>You</small></div>{status === 'Live' && people.map(person => <div key={person.deviceId}><span className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />{person.displayName || 'Guest'}</div>)}</div>
      {collaborationPanel}
      <form onSubmit={submit}><label htmlFor="live-display-name">Display name</label><div className="name-input"><input id="live-display-name" autoComplete="off" maxLength={32} value={name} onChange={event => setName(event.target.value)} /><button type="submit">Save</button></div></form>
      <label htmlFor="live-theme">Appearance</label><select id="live-theme" value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <div className="menu-heading menu-tools-heading">CANVAS CONTROLS</div>
      <button type="button" className="menu-action" disabled={!api || status !== 'Live'} onClick={activateFrame}><Icon name="frame" />Frame tool</button>
      <button type="button" className="menu-action" disabled={!api} onClick={() => downloadBackup(api)}><Icon name="download" />Export JSON backup</button>
      <button type="button" className="menu-action" disabled={!api} onClick={() => { fit(); setMenu(false) }}><Icon name="fit" />Fit all content</button>
      <button type="button" className="menu-action" disabled={!api || status !== 'Live' || !hasLockedElements} onClick={() => { unlockAll(); setMenu(false) }}><Icon name="select" />Unlock all locked objects</button>
      <p className="privacy-note">One shared canvas. Anyone with the link can read and change everything. Names are not verified identities.</p>
      <p className="shortcut-note">V Select · R Rectangle · D Diamond · O Ellipse · A Arrow · L Line<br />P/X Pen · Shift+E Stroke eraser · E Object eraser · T Text · F Frame · Space Pan</p>
    </div>}
  </header>
}

export default function SupabaseCanvasEditor({ config }: { config: LiveConfig }) {
  const storage = useMemo(browserStorage, [])
  const [identity, setIdentity] = useState(() => loadIdentity(storage))
  const identityRef = useRef(identity)
  const [theme, setTheme] = useState(() => loadTheme(storage))
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visualProfile, setVisualProfile] = useState<CanvasVisualProfile>(() => loadVisualProfile(storage))
  const visualProfileRef = useRef(visualProfile)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const richTextLayerRef = useRef<RichTextLayerHandle | null>(null)
  const shapeLayerRef = useRef<CanvasShapeLayerHandle | null>(null)
  const navigationRef = useRef<NavigationOverlayHandle | null>(null)
  const backdropRef = useRef<CanvasBackdropHandle | null>(null)
  const [richTextMode, setRichTextMode] = useState(false)
  const [drawingMode, setDrawingMode] = useState<DrawingMode | null>(null)
  const drawingModeRef = useRef<DrawingMode | null>(null)
  const [drawingSettings, setDrawingSettings] = useState<DrawingControlSettings>(() => ({
    penColor: drawingColorPreference(storage, 'canvas.pen-color.v1', '#1f2937'),
    penWidth: drawingNumberPreference(storage, 'canvas.pen-width.v1', 2, 0.5, 32),
    penOpacity: drawingNumberPreference(storage, 'canvas.pen-opacity.v1', 100, 5, 100),
    smoothing: drawingNumberPreference(storage, 'canvas.pen-smoothing.v1', 55, 0, 100),
    pressure: drawingBooleanPreference(storage, 'canvas.pen-pressure.v1', true),
    highlighterColor: drawingColorPreference(storage, 'canvas.highlighter-color.v1', '#ffd43b'),
    highlighterWidth: drawingNumberPreference(storage, 'canvas.highlighter-width.v1', 16, 2, 32),
    eraserRadius: drawingNumberPreference(storage, 'canvas.stroke-eraser-radius.v1', 10, 4, 48),
    holdToClean: drawingBooleanPreference(storage, 'canvas.hold-clean.v1', true),
    stylusMode: drawingBooleanPreference(storage, 'canvas.stylus-mode.v1', true),
  }))
  const drawingSettingsRef = useRef(drawingSettings)
  const drawingGestureRef = useRef<{
    pointerId: number
    mode: 'pen' | 'highlighter'
    beforeIds: Set<string>
    lastMoveAt: number
    lastClientX: number
    lastClientY: number
  } | null>(null)
  const partialEraserRef = useRef<{ pointerId: number; path: ScenePoint[] } | null>(null)
  const touchPointersRef = useRef(new Set<number>())
  const penPointersRef = useRef(new Set<number>())
  const [eraserPreview, setEraserPreview] = useState<{ x: number; y: number; radius: number } | null>(null)
  const [objectsSnapModeEnabled, setObjectsSnapModeEnabled] = useState(() => readPreference(storage, 'canvas.objects-snap.v1') !== 'false')
  const [gridModeEnabled, setGridModeEnabled] = useState(() => readPreference(storage, 'canvas.grid-mode.v1') === 'true')
  const [selectionSnapshot, setSelectionSnapshot] = useState<CanvasSelectionSnapshot>({
    elements: [],
    selectedGroupIds: {},
    editingGroupId: null,
    objectsSnapModeEnabled,
    gridModeEnabled,
  })
  const selectionSignatureRef = useRef('')
  const [hasLockedElements, setHasLockedElements] = useState(false)
  const [status, setStatus] = useState<ConnectionState>('Connecting')
  const statusRef = useRef<ConnectionState>('Connecting')
  useEffect(() => { drawingModeRef.current = drawingMode }, [drawingMode])
  useEffect(() => { drawingSettingsRef.current = drawingSettings }, [drawingSettings])
  const [syncRuntime, setSyncRuntime] = useState<SyncRuntimeState>({ queuedChanges: 0, writeInFlight: false, assetTransfers: 0, localEditing: false, saveIssue: 'none' })
  const syncRuntimeRef = useRef(syncRuntime)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const pageActiveRef = useRef(true)
  const channelCleanupRef = useRef<Promise<unknown>>(Promise.resolve())
  const retryDelayRef = useRef(1200)
  const reconciliationCursorRef = useRef(0)
  const reconciliationInFlightRef = useRef(false)
  const dropRealtimeForDiagnosticsRef = useRef(canvasDiagnostics.enabled && new URLSearchParams(window.location.search).get('dropRealtime') === '1')
  const [people, setPeople] = useState<PresencePerson[]>([])
  const collaborationSessionIdRef = useRef(globalThis.crypto?.randomUUID?.() ?? `collaboration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const collaborationSequenceRef = useRef(0)
  const collaborationEffectSequenceRef = useRef(0)
  const collaborationSequenceGateRef = useRef(new CollaborationSequenceGate())
  const collaborationEffectGateRef = useRef(new CollaborationSequenceGate())
  const remoteCollaborationRef = useRef(new Map<string, RemoteCollaborationState>())
  const [remoteCollaboration, setRemoteCollaboration] = useState<RemoteCollaborationState[]>([])
  const [collaborationEffects, setCollaborationEffects] = useState<CollaborationEffectView[]>([])
  const [followDeviceId, setFollowDeviceId] = useState<string | null>(null)
  const followDeviceIdRef = useRef<string | null>(null)
  const [showRemoteCursors, setShowRemoteCursors] = useState(() => readPreference(storage, 'canvas.show-remote-cursors.v1') !== 'false')
  const [shareCursor, setShareCursor] = useState(() => readPreference(storage, 'canvas.share-cursor.v1') !== 'false')
  const shareCursorRef = useRef(shareCursor)
  const [viewportRevision, setViewportRevision] = useState(0)
  const latestLocalPointerRef = useRef<{ x: number; y: number; tool: 'pointer' | 'laser'; button: 'up' | 'down' } | null>(null)
  const collaborationActivityRef = useRef<CollaborationActivity>('idle')
  const collaborationSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collaborationLastSentAtRef = useRef(0)
  const collaborationStateQueuedRef = useRef(false)
  const queueCollaborationStateRef = useRef<(immediate?: boolean) => void>(() => {})
  const localSceneSnapshotRef = useRef(new Map<string, SceneElement>())
  const ownUndoBeforeRef = useRef(new Map<string, SceneElement | null>())
  const ownUndoStackRef = useRef<OwnUndoEntry<SceneElement>[]>([])
  const applyAuthoritativeRowsRef = useRef<(values: unknown[]) => void>(() => {})
  const assetReadyRef = useRef(new Set<string>())
  const assetUploadPromisesRef = useRef(new Map<string, Promise<void>>())
  const assetDownloadPromisesRef = useRef(new Map<string, Promise<void>>())
  const assetUploadQueueRef = useRef(new BoundedTaskQueue(4))
  const assetDownloadQueueRef = useRef(new BoundedTaskQueue(4))
  const assetUploadFailuresRef = useRef(new Set<string>())
  const assetDownloadFailuresRef = useRef(new Set<string>())
  const assetTransferCountRef = useRef(0)
  const undoInFlightRef = useRef(false)
  const [undoInFlight, setUndoInFlight] = useState(false)
  const [undoDepth, setUndoDepth] = useState(0)
  const [notice, setNotice] = useState('')
  const [delightBurst, setDelightBurst] = useState(0)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const shadowRef = useRef(new Map<string, VersionStamp>())
  const authoritativeElementsRef = useRef(new Map<string, SceneElement>())
  const observedSceneRef = useRef(new Map<string, VersionStamp>())
  const sceneVersionIndexRef = useRef(new SceneVersionIndex<SceneElement>())
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
  const durableInFlightRef = useRef(new Map<string, SceneElement>())
  const recoveryLoadedRef = useRef(false)
  const recoveryWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const recoveryWarningRef = useRef(false)
  const persistRecoveryStateRef = useRef<() => void>(() => {})
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
  const patchSyncRuntime = useCallback((patch: Partial<SyncRuntimeState>) => {
    const current = syncRuntimeRef.current
    const next = { ...current, ...patch }
    syncRuntimeRef.current = next
    if (next.queuedChanges === current.queuedChanges && next.writeInFlight === current.writeInFlight && next.assetTransfers === current.assetTransfers && next.localEditing === current.localEditing && next.saveIssue === current.saveIssue) return
    setSyncRuntime(next)
  }, [])
  const operationTracker = useMemo(() => new CanvasOperationTracker<SceneElement>({
    deviceId: () => identityRef.current.deviceId,
    onCommit: mutation => {
      recordMutationDiagnostics(mutation)
      const undoChanges = mutation.changes.flatMap(change => {
        const element = change.type === 'delete' ? change.tombstone : change.element
        if (!isPersistableCanvasElement(element)) return []
        const rawBefore = ownUndoBeforeRef.current.has(element.id)
          ? ownUndoBeforeRef.current.get(element.id) ?? null
          : change.existedBefore ? authoritativeElementsRef.current.get(element.id) ?? null : null
        const before = element.type === 'image'
          && element.status === 'saved'
          && rawBefore?.type === 'image'
          && rawBefore.status !== 'saved'
          ? (() => {
              const authority = authoritativeElementsRef.current.get(element.id)
              return authority?.type === 'image' && authority.status === 'saved' ? authority : null
            })()
          : rawBefore
        return [{ id: element.id, before, after: stampOf(element) }]
      })
      for (const change of mutation.changes) {
        const element = change.type === 'delete' ? change.tombstone : change.element
        ownUndoBeforeRef.current.delete(element.id)
      }
      if (undoChanges.length) {
        ownUndoStackRef.current.push({ mutationId: mutation.mutationId, committedAt: mutation.committedAt, changes: undoChanges })
        if (ownUndoStackRef.current.length > 100) ownUndoStackRef.current.splice(0, ownUndoStackRef.current.length - 100)
      }
      setUndoDepth(ownUndoStackRef.current.length)
      if (mutation.source === 'pointer' || mutation.source === 'text') {
        commitPreviewRef.current(mutation.source, mutation.changes.map(change => change.type === 'delete' ? change.tombstone : change.element))
      }
      for (const change of mutation.changes) {
        const element = change.type === 'delete' ? change.tombstone : change.element
        const nextStamp = stampOf(element)
        if (!isPersistableCanvasElement(element) || !isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
        const queued = durablePendingRef.current.get(element.id)
        if (!queued || isNewerVersion(nextStamp, stampOf(queued))) durablePendingRef.current.set(element.id, element)
      }
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
      patchSyncRuntime({ queuedChanges: durablePendingRef.current.size, localEditing: false })
      persistRecoveryStateRef.current()
      durabilityCommitRef.current()
    },
  }), [patchSyncRuntime])

  const supabase = useMemo(() => createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), [config.supabaseKey, config.supabaseUrl])
  const assetBucket = useMemo(() => assetBucketForTable(config.tableName), [config.tableName])

  const resolvedTheme = theme === 'system' ? systemDark ? 'dark' : 'light' : theme
  const resolvedMotion = resolveCanvasMotion(visualProfile.motion, systemReducedMotion)
  const backdropProfile = useMemo<CanvasVisualProfile>(() => ({
    ...visualProfile,
    gridPattern: gridModeEnabled && visualProfile.gridPattern !== 'squares' ? visualProfile.gridPattern : 'none',
  }), [gridModeEnabled, visualProfile])
  const syncHealth = useMemo(() => deriveSyncHealth({ connection: status, ...syncRuntime }), [status, syncRuntime])
  const recoveryNotice = recoveryMessage(syncHealth)

  const notify = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])

  const persistRecoveryState = useCallback(() => {
    const tableName = config.tableName
    const deviceId = identityRef.current.deviceId
    const byId = new Map<string, SceneElement>()
    for (const source of [durableInFlightRef.current, durablePendingRef.current]) {
      for (const element of source.values()) {
        if (!isPersistableCanvasElement(element)) continue
        const previous = byId.get(element.id)
        if (!previous || isNewerVersion(stampOf(element), stampOf(previous))) byId.set(element.id, element)
      }
    }
    const elements = [...byId.values()]
    recoveryWriteChainRef.current = recoveryWriteChainRef.current
      .catch(() => {})
      .then(async () => {
        if (!elements.length) {
          await clearRecoveryJournal(tableName, deviceId)
          canvasDiagnostics.gauge('recoveryJournalElements', 0)
          return
        }
        const result = await writeRecoveryJournal(tableName, deviceId, elements as unknown as RecoveryElement[])
        if (result.ok) {
          recoveryWarningRef.current = false
          canvasDiagnostics.gauge('recoveryJournalElements', result.stored)
          canvasDiagnostics.gauge('recoveryJournalBytes', result.bytes)
          canvasDiagnostics.increment('recoveryJournalWrites')
          return
        }
        canvasDiagnostics.increment('recoveryJournalFailures')
        if (!recoveryWarningRef.current && (result.reason === 'quota' || result.reason === 'invalid')) {
          recoveryWarningRef.current = true
          notify(result.reason === 'quota'
            ? 'Local crash recovery storage is full. Shared saving still works, but avoid closing Canvas until changes show Saved.'
            : 'Canvas could not store a local crash-recovery snapshot. Shared saving still works.')
        }
      })
    return recoveryWriteChainRef.current
  }, [config.tableName, notify])

  useEffect(() => {
    persistRecoveryStateRef.current = persistRecoveryState
    return () => { persistRecoveryStateRef.current = () => {} }
  }, [persistRecoveryState])

  const adjustAssetTransfers = useCallback((delta: number) => {
    assetTransferCountRef.current = Math.max(0, assetTransferCountRef.current + delta)
    patchSyncRuntime({ assetTransfers: assetTransferCountRef.current })
    canvasDiagnostics.gauge('assetTransfers', assetTransferCountRef.current)
  }, [patchSyncRuntime])

  const ensureUploadedAsset = useCallback((file: BinaryFileData): Promise<void> => {
    const id = file.id as string
    if (assetReadyRef.current.has(id)) {
      const editor = apiRef.current
      if (editor) {
        const current = editor.getSceneElementsIncludingDeleted()
        const promoted = markImagesSaved(current, id)
        if (promoted.some((element, index) => element !== current[index])) {
          editor.updateScene({ elements: promoted, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        }
      }
      assetUploadFailuresRef.current.delete(id)
      if (assetUploadFailuresRef.current.size === 0 && syncRuntimeRef.current.saveIssue === 'asset-error') {
        patchSyncRuntime({ saveIssue: 'none' })
      }
      return Promise.resolve()
    }
    const existing = assetUploadPromisesRef.current.get(id)
    if (existing) return existing
    if (assetUploadFailuresRef.current.has(id)) return Promise.reject(new Error('Image upload is waiting for a retry.'))

    const promise = assetUploadQueueRef.current.enqueue(id, async () => {
      adjustAssetTransfers(1)
      canvasDiagnostics.gauge('assetUploadQueueDepth', assetUploadQueueRef.current.size)
      canvasDiagnostics.increment('assetUploadsStarted')
      try {
        await uploadCanvasAsset(supabase, assetBucket, file)
        assetReadyRef.current.add(id)
        assetUploadFailuresRef.current.delete(id)
        if (assetUploadFailuresRef.current.size === 0 && syncRuntimeRef.current.saveIssue === 'asset-error') {
          patchSyncRuntime({ saveIssue: 'none' })
        }
        canvasDiagnostics.increment('assetUploadsCompleted')
        const editor = apiRef.current
        if (!editor) return
        const current = editor.getSceneElementsIncludingDeleted()
        const next = markImagesSaved(current, id)
        if (next.some((element, index) => element !== current[index])) {
          editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        }
      } catch (error) {
        assetUploadFailuresRef.current.add(id)
        patchSyncRuntime({ saveIssue: 'asset-error' })
        canvasDiagnostics.increment('assetUploadFailures')
        const editor = apiRef.current
        if (editor) {
          const current = editor.getSceneElementsIncludingDeleted()
          const next = markImagesErrored(current, id)
          if (next.some((element, index) => element !== current[index])) {
            editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER })
          }
        }
        notify(`Image could not be saved: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      } finally {
        adjustAssetTransfers(-1)
        canvasDiagnostics.gauge('assetUploadQueueDepth', assetUploadQueueRef.current.size)
      }
    })
    assetUploadPromisesRef.current.set(id, promise)
    void promise.then(
      () => assetUploadPromisesRef.current.delete(id),
      () => assetUploadPromisesRef.current.delete(id),
    )
    canvasDiagnostics.gauge('assetUploadQueueDepth', assetUploadQueueRef.current.size)
    return promise
  }, [adjustAssetTransfers, assetBucket, notify, patchSyncRuntime, supabase])

  const ensureAssetsForElements = useCallback((elements: readonly SceneElement[]) => {
    const editor = apiRef.current
    if (!editor) return
    const files = editor.getFiles()
    for (const id of referencedAssetIds(elements)) {
      if (files[id] || assetDownloadPromisesRef.current.has(id) || assetDownloadFailuresRef.current.has(id)) continue
      const promise = assetDownloadQueueRef.current.enqueue(id, async () => {
        adjustAssetTransfers(1)
        canvasDiagnostics.gauge('assetDownloadQueueDepth', assetDownloadQueueRef.current.size)
        canvasDiagnostics.increment('assetDownloadsStarted')
        try {
          const file = await downloadCanvasAsset(supabase, assetBucket, id)
          if (!pageActiveRef.current) return
          assetReadyRef.current.add(id)
          assetDownloadFailuresRef.current.delete(id)
          apiRef.current?.addFiles([file])
          canvasDiagnostics.increment('assetDownloadsCompleted')
        } catch (error) {
          assetDownloadFailuresRef.current.add(id)
          canvasDiagnostics.increment('assetDownloadFailures')
          notify(`Image could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          adjustAssetTransfers(-1)
          canvasDiagnostics.gauge('assetDownloadQueueDepth', assetDownloadQueueRef.current.size)
        }
      })
      assetDownloadPromisesRef.current.set(id, promise)
      void promise.then(
        () => assetDownloadPromisesRef.current.delete(id),
        () => assetDownloadPromisesRef.current.delete(id),
      )
      canvasDiagnostics.gauge('assetDownloadQueueDepth', assetDownloadQueueRef.current.size)
    }
  }, [adjustAssetTransfers, assetBucket, notify, supabase])

  const observeLocalFiles = useCallback((files: BinaryFiles, elements: readonly SceneElement[]) => {
    const activeImageIds = new Set(
      elements.flatMap(element => element.type === 'image' && !element.isDeleted && element.fileId
        ? [element.fileId as string]
        : []),
    )
    for (const id of [...assetUploadFailuresRef.current]) {
      if (!activeImageIds.has(id)) assetUploadFailuresRef.current.delete(id)
    }
    if (assetUploadFailuresRef.current.size === 0 && syncRuntimeRef.current.saveIssue === 'asset-error') {
      patchSyncRuntime({ saveIssue: 'none' })
    }

    const pendingIds = new Set(
      elements.flatMap(element => element.type === 'image' && !element.isDeleted && element.status === 'pending' && element.fileId
        ? [element.fileId as string]
        : []),
    )
    for (const id of pendingIds) {
      const file = files[id]
      if (!file || assetReadyRef.current.has(id) || assetUploadPromisesRef.current.has(id)) continue
      assetUploadFailuresRef.current.delete(id)
      void ensureUploadedAsset(file).catch(() => {})
    }
  }, [ensureUploadedAsset, patchSyncRuntime])

  const retryFailedAssets = useCallback(() => {
    const editor = apiRef.current
    if (!editor || !navigator.onLine || statusRef.current !== 'Live') return
    const files = editor.getFiles()
    const current = editor.getSceneElementsIncludingDeleted()
    const failedUploads = new Set(assetUploadFailuresRef.current)
    if (failedUploads.size) {
      assetUploadFailuresRef.current.clear()
      const next = current.map(element => element.type === 'image'
        && !element.isDeleted
        && element.status === 'error'
        && element.fileId
        && failedUploads.has(element.fileId as string)
        && files[element.fileId as string]
        ? newElementWith(element, { status: 'pending' })
        : element)
      if (next.some((element, index) => element !== current[index])) {
        editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER })
      }
      for (const id of failedUploads) {
        const file = files[id]
        if (file) void ensureUploadedAsset(file).catch(() => {})
      }
    }
    if (assetDownloadFailuresRef.current.size) {
      assetDownloadFailuresRef.current.clear()
      ensureAssetsForElements(editor.getSceneElementsIncludingDeleted())
    }
  }, [ensureAssetsForElements, ensureUploadedAsset])

  // Network callbacks must lock writes immediately, before React commits a render.
  const transition = useCallback((next: ConnectionState) => {
    statusRef.current = next
    setStatus(next)
    if (next !== 'Live') patchSyncRuntime({ localEditing: false })
  }, [patchSyncRuntime])

  const publishRemoteCollaboration = useCallback(() => {
    setRemoteCollaboration([...remoteCollaborationRef.current.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)))
  }, [])

  const localCollaborationViewport = useCallback((): CollaborationViewport | null => {
    const editor = apiRef.current
    if (!editor) return null
    const state = editor.getAppState()
    return { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height }
  }, [])

  const sendCollaborationStateNow = useCallback(() => {
    if (!pageActiveRef.current || !navigator.onLine || (statusRef.current !== 'Live' && statusRef.current !== 'Synchronizing')) return
    const channel = channelRef.current
    const editor = apiRef.current
    const viewport = localCollaborationViewport()
    if (!channel || !editor || !viewport) return
    const selectedElementIds = Object.entries(editor.getAppState().selectedElementIds).filter(([, selected]) => selected).map(([id]) => id)
    const pointer = shareCursorRef.current ? latestLocalPointerRef.current : null
    const payload = createCollaborationStatePayload({
      deviceId: identityRef.current.deviceId,
      sessionId: collaborationSessionIdRef.current,
      sequence: ++collaborationSequenceRef.current,
      sentAt: Date.now(),
      displayName: identityRef.current.displayName,
      color: identityRef.current.color,
      cursorVisible: shareCursorRef.current,
      pointer,
      selectedElementIds,
      viewport,
      activity: collaborationActivityRef.current,
    })
    if (!payload) {
      canvasDiagnostics.increment('collaborationStateRejectedLocally')
      return
    }
    collaborationLastSentAtRef.current = performance.now()
    collaborationStateQueuedRef.current = false
    canvasDiagnostics.increment('collaborationStateSent')
    void channel.send({ type: 'broadcast', event: 'collab-state', payload }).then(result => {
      if (result !== 'ok') canvasDiagnostics.increment('collaborationStateSendFailures')
    }).catch(() => { canvasDiagnostics.increment('collaborationStateSendFailures') })
  }, [localCollaborationViewport])

  const queueCollaborationState = useCallback((immediate = false) => {
    collaborationStateQueuedRef.current = true
    if (collaborationSendTimerRef.current && immediate) {
      clearTimeout(collaborationSendTimerRef.current)
      collaborationSendTimerRef.current = null
    }
    if (immediate) {
      sendCollaborationStateNow()
      return
    }
    const elapsed = performance.now() - collaborationLastSentAtRef.current
    if (elapsed >= COLLABORATION_BROADCAST_INTERVAL_MS) {
      sendCollaborationStateNow()
      return
    }
    if (collaborationSendTimerRef.current) return
    collaborationSendTimerRef.current = setTimeout(() => {
      collaborationSendTimerRef.current = null
      if (collaborationStateQueuedRef.current) sendCollaborationStateNow()
    }, Math.max(0, COLLABORATION_BROADCAST_INTERVAL_MS - elapsed))
  }, [sendCollaborationStateNow])

  useEffect(() => {
    queueCollaborationStateRef.current = queueCollaborationState
    return () => { queueCollaborationStateRef.current = () => {} }
  }, [queueCollaborationState])

  const setCollaborationActivity = useCallback((activity: CollaborationActivity) => {
    if (collaborationActivityRef.current === activity) return
    collaborationActivityRef.current = activity
    queueCollaborationStateRef.current(true)
  }, [])

  const applyFollowerViewport = useCallback((viewport: CollaborationViewport) => {
    const editor = apiRef.current
    if (!editor) return
    const current = editor.getAppState()
    const next = followerViewport(viewport, { width: current.width, height: current.height })
    editor.updateScene({
      appState: {
        zoom: { value: next.zoom } as AppState['zoom'],
        scrollX: next.scrollX,
        scrollY: next.scrollY,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    navigationRef.current?.sync(editor.getSceneElementsIncludingDeleted(), editor.getAppState())
    setViewportRevision(value => value + 1)
  }, [])

  const applyCollaborationState = useCallback((value: unknown) => {
    const payload = parseCollaborationStatePayload(value)
    if (!payload || payload.deviceId === identityRef.current.deviceId || isStaleCollaborationPayload(payload.sentAt)) {
      if (value && typeof value === 'object') canvasDiagnostics.increment('collaborationStateRejected')
      return
    }
    if (!collaborationSequenceGateRef.current.accept(payload.deviceId, payload.sessionId, payload.sequence)) {
      canvasDiagnostics.increment('collaborationStateStale')
      return
    }
    const remote: RemoteCollaborationState = {
      ...payload,
      displayName: cleanName(payload.displayName),
      color: safeColor(payload.color),
      receivedAt: Date.now(),
    }
    remoteCollaborationRef.current.set(payload.deviceId, remote)
    publishRemoteCollaboration()
    const socketId = payload.deviceId as SocketId
    const existing = collaboratorsRef.current.get(socketId)
    collaboratorsRef.current.set(socketId, {
      ...existing,
      username: remote.displayName,
      selectedElementIds: Object.fromEntries(payload.selectedElementIds.map(id => [id, true])),
    } as Collaborator)
    apiRef.current?.updateScene({ collaborators: new Map(collaboratorsRef.current) })
    if (followDeviceIdRef.current === payload.deviceId) applyFollowerViewport(payload.viewport)
    canvasDiagnostics.increment('collaborationStateReceived')
  }, [applyFollowerViewport, publishRemoteCollaboration])

  const addCollaborationEffect = useCallback((payload: CollaborationEffectPayload) => {
    const now = Date.now()
    const view: CollaborationEffectView = {
      ...payload,
      effectId: `${payload.deviceId}:${payload.sessionId}:${payload.sequence}:${payload.kind}`,
      expiresAt: now + COLLABORATION_REACTION_TTL_MS,
    }
    setCollaborationEffects(current => [...current.filter(item => item.expiresAt > now), view].slice(-32))
  }, [])

  const applyCollaborationEffect = useCallback((value: unknown) => {
    const payload = parseCollaborationEffectPayload(value)
    if (!payload || payload.deviceId === identityRef.current.deviceId || isStaleCollaborationPayload(payload.sentAt)) return
    if (!collaborationEffectGateRef.current.accept(payload.deviceId, payload.sessionId, payload.sequence)) return
    if (payload.targetDeviceId && payload.targetDeviceId !== identityRef.current.deviceId) return
    addCollaborationEffect(payload)
    if (payload.kind === 'ping' && payload.targetDeviceId === identityRef.current.deviceId) notify(`${cleanName(payload.displayName)} wants your attention.`)
  }, [addCollaborationEffect, notify])

  const sendCollaborationEffect = useCallback((kind: 'ping' | 'reaction', emoji: CollaborationReaction | null, targetDeviceId: string | null = null) => {
    if (statusRef.current !== 'Live' || !navigator.onLine) return
    const channel = channelRef.current
    const viewport = localCollaborationViewport()
    if (!channel || !viewport) return
    const point = latestLocalPointerRef.current
      ? { x: latestLocalPointerRef.current.x, y: latestLocalPointerRef.current.y }
      : viewportCenter(viewport)
    const payload = createCollaborationEffectPayload({
      kind,
      deviceId: identityRef.current.deviceId,
      sessionId: collaborationSessionIdRef.current,
      sequence: ++collaborationEffectSequenceRef.current,
      sentAt: Date.now(),
      displayName: identityRef.current.displayName,
      color: identityRef.current.color,
      targetDeviceId,
      point,
      emoji,
    })
    if (!payload) return
    addCollaborationEffect(payload)
    void channel.send({ type: 'broadcast', event: 'collab-effect', payload }).catch(() => {})
  }, [addCollaborationEffect, localCollaborationViewport])

  const jumpToCollaborator = useCallback((deviceId: string) => {
    const remote = remoteCollaborationRef.current.get(deviceId)
    if (!remote) {
      notify('That collaborator has not shared a current viewport yet.')
      return
    }
    applyFollowerViewport(remote.viewport)
  }, [applyFollowerViewport, notify])

  const toggleFollowCollaborator = useCallback((deviceId: string) => {
    const next = followDeviceIdRef.current === deviceId ? null : deviceId
    followDeviceIdRef.current = next
    setFollowDeviceId(next)
    if (next) {
      const remote = remoteCollaborationRef.current.get(next)
      if (remote) applyFollowerViewport(remote.viewport)
    }
  }, [applyFollowerViewport])

  const stopFollowing = useCallback(() => {
    followDeviceIdRef.current = null
    setFollowDeviceId(null)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [deviceId, remote] of remoteCollaborationRef.current) {
        if (now - remote.receivedAt <= COLLABORATION_IDLE_POINTER_AFTER_MS) continue
        if (!remote.pointer && remote.activity === 'idle') continue
        remoteCollaborationRef.current.set(deviceId, { ...remote, pointer: null, activity: 'idle' })
        changed = true
      }
      if (changed) publishRemoteCollaboration()
      setCollaborationEffects(current => {
        const next = current.filter(effect => effect.expiresAt > now)
        return next.length === current.length ? current : next
      })
    }, 500)
    return () => clearInterval(timer)
  }, [publishRemoteCollaboration])

  const restoreRemotePreviews = useCallback((records: RemotePreview[]) => {
    const editor = apiRef.current
    if (!editor || records.length === 0) return
    const current = editor.getSceneElementsIncludingDeleted()
    const currentById = indexSceneById(current)
    const replacements = new Map<string, SceneElement | null>()
    for (const record of records) {
      const visible = currentById.get(record.element.id)
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
    sceneVersionIndexRef.current.replace(next, isAllowedElement)
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
    // Ephemeral previews are intentionally not authoritative scene-index state.
    // Their delayed onChange callbacks are quarantined below, so the index can
    // remain anchored to the last local/authoritative immutable version.
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
        if (!ownUndoBeforeRef.current.has(element.id)) ownUndoBeforeRef.current.set(element.id, localSceneSnapshotRef.current.get(element.id) ?? null)
        operationTracker.record(element, observed !== undefined)
        observedSceneRef.current.set(element.id, nextStamp)
      }
      localSceneSnapshotRef.current.set(element.id, element)
      const queued = pendingRef.current.get(element.id)
      if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
      if (isPersistableCanvasElement(element)) {
        const durable = durablePendingRef.current.get(element.id)
        if (!durable || isNewerVersion(nextStamp, stampOf(durable))) durablePendingRef.current.set(element.id, element)
      }
    }
    canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
    patchSyncRuntime({ queuedChanges: durablePendingRef.current.size, localEditing: false })
    persistRecoveryStateRef.current()
    continuousOperationRef.current = null
    clearCheckpointRef.current()
    operationTracker.flush()
  }, [operationTracker, patchSyncRuntime])

  const undoMyLastAction = useCallback(async () => {
    const editor = apiRef.current
    const entry = ownUndoStackRef.current.at(-1)
    if (!editor || statusRef.current !== 'Live' || !entry || undoInFlightRef.current) return

    const affectedIds = new Set(entry.changes.map(change => change.id))
    const hasUnconfirmedLocalWork = writeInFlightRef.current
      || syncRuntimeRef.current.saveIssue !== 'none'
      || [...affectedIds].some(id => pendingRef.current.has(id) || durablePendingRef.current.has(id))
    if (hasUnconfirmedLocalWork) {
      notify('Wait for the current action to finish saving before undoing it.')
      return
    }

    const current = editor.getSceneElementsIncludingDeleted()
    const currentById = indexSceneById(current)
    if (!canUndoOwnAction(entry, currentById)) {
      notify('That action cannot be undone safely because a collaborator changed one of its objects.')
      return
    }

    const changes = entry.changes.flatMap(change => {
      const element = currentById.get(change.id)
      if (!element) return []
      const restored = restoreOwnActionElement(element, change.before)
      return [{
        id: change.id,
        expectedVersion: change.after.version,
        expectedVersionNonce: change.after.versionNonce,
        expectedIsDeleted: change.after.isDeleted,
        version: restored.version,
        versionNonce: restored.versionNonce,
        isDeleted: restored.isDeleted,
        element: restored,
      }]
    })
    if (changes.length !== entry.changes.length) {
      notify('That action cannot be undone because one of its objects is no longer available.')
      return
    }

    undoInFlightRef.current = true
    setUndoInFlight(true)
    canvasDiagnostics.increment('ownUndoAttempts')
    try {
      const functionName = config.tableName === 'canvas_ci_elements' ? 'canvas_ci_apply_own_undo' : 'canvas_apply_own_undo'
      const { data, error } = await supabase.rpc(functionName, {
        p_changes: changes,
        p_updated_by: identityRef.current.deviceId,
      })
      if (error) {
        if (error.code === 'PT409' || error.code === '40001' || /Canvas undo conflict/i.test(error.message)) {
          canvasDiagnostics.increment('ownUndoConflicts')
          notify('That action cannot be undone safely because a collaborator changed one of its objects.')
        } else {
          canvasDiagnostics.increment('ownUndoFailures')
          notify(`Canvas could not undo that action: ${error.message}`)
        }
        return
      }
      if (!Array.isArray(data) || data.length !== changes.length) {
        canvasDiagnostics.increment('ownUndoFailures')
        notify('Canvas could not confirm the undo transaction.')
        return
      }

      const latest = ownUndoStackRef.current.at(-1)
      if (latest?.mutationId === entry.mutationId) ownUndoStackRef.current.pop()
      setUndoDepth(ownUndoStackRef.current.length)
      applyAuthoritativeRowsRef.current(data)
      canvasDiagnostics.increment('ownUndoSuccesses')
    } catch (error) {
      canvasDiagnostics.increment('ownUndoFailures')
      notify(`Canvas could not undo that action: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      undoInFlightRef.current = false
      setUndoInFlight(false)
    }
  }, [config.tableName, notify, supabase])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (statusRef.current !== 'Live' || ownUndoStackRef.current.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      undoMyLastAction()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [undoMyLastAction])

  useEffect(() => { identityRef.current = identity }, [identity])
  useEffect(() => { shareCursorRef.current = shareCursor }, [shareCursor])
  useEffect(() => { followDeviceIdRef.current = followDeviceId }, [followDeviceId])
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
      patchSyncRuntime({ localEditing: true })
      const activeTool = apiRef.current?.getAppState().activeTool.type
      if (drawingModeRef.current || activeTool && ['freedraw', 'rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'frame'].includes(activeTool)) setCollaborationActivity('drawing')
      armCheckpointRef.current()
    }
    const pointerEnd = () => {
      if (continuousOperationRef.current !== 'pointer') return
      continuousOperationRef.current = null
      patchSyncRuntime({ localEditing: false })
      clearCheckpointRef.current()
      operationTracker.endPointer()
      if (collaborationActivityRef.current === 'drawing') setCollaborationActivity('idle')
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('pointerup', pointerEnd, true)
    document.addEventListener('pointercancel', pointerEnd, true)
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('pointerup', pointerEnd, true)
      document.removeEventListener('pointercancel', pointerEnd, true)
    }
  }, [operationTracker, patchSyncRuntime, setCollaborationActivity])
  useEffect(() => {
    pageActiveRef.current = true
    const hide = () => {
      clearRemotePreviews()
      captureCurrentScene()
      persistRecoveryStateRef.current()
      // Navigation may reject an outstanding save. Its recovery callback must
      // not start another fetch in the document that is being torn down.
      pageActiveRef.current = false
      transition(navigator.onLine ? 'Reconnecting' : 'Offline')
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
      if (checkpointTimer.current) { clearTimeout(checkpointTimer.current); checkpointTimer.current = null }
      if (previewSendTimerRef.current) { clearTimeout(previewSendTimerRef.current); previewSendTimerRef.current = null }
      if (collaborationSendTimerRef.current) { clearTimeout(collaborationSendTimerRef.current); collaborationSendTimerRef.current = null }
      previewSendQueuedRef.current = null
      collaborationStateQueuedRef.current = false
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
      if (collaborationSendTimerRef.current) { clearTimeout(collaborationSendTimerRef.current); collaborationSendTimerRef.current = null }
      previewSendQueuedRef.current = null
      collaborationStateQueuedRef.current = false
      clearRemotePreviews()
    }
  }, [captureCurrentScene, clearRemotePreviews, transition])
  useEffect(() => {
    visualProfileRef.current = visualProfile
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.canvasMotion = resolvedMotion
    document.documentElement.dataset.canvasAccent = visualProfile.accent
    document.documentElement.dataset.canvasPaper = visualProfile.paper
  }, [resolvedMotion, resolvedTheme, visualProfile])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReducedMotion(media.matches)
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
    const localById = indexSceneById(localElements)
    const remoteElements: SceneElement[] = []
    if (replace) {
      shadowRef.current.clear()
      authoritativeElementsRef.current.clear()
      observedSceneRef.current.clear()
      sceneVersionIndexRef.current.clear()
      remotePreviewRef.current.clear()
      previewEchoStampsRef.current.clear()
      previewSequenceGateRef.current.clear()
      canvasDiagnostics.gauge('activeRemotePreviews', 0)
    }
    let changed = replace
    let recoveryChanged = false

    for (const row of rows) {
      const element = elementFromRow(row)
      if (!element) continue
      const nextStamp = { version: row.version, versionNonce: row.version_nonce, isDeleted: row.is_deleted }
      const previousAuthority = authoritativeElementsRef.current.get(row.id)
      if (replace || !previousAuthority || isNewerVersion(nextStamp, stampOf(previousAuthority))) {
        authoritativeElementsRef.current.set(row.id, element)
        // Content-free observability for the exact map preview expiry restores from.
        // This proves authority was accepted locally without recording element data.
        canvasDiagnostics.increment('authoritativeRowsAccepted')
      }
      const activePreview = remotePreviewRef.current.get(row.id)
      if (activePreview && !isNewerVersion(stampOf(activePreview.element), nextStamp)) {
        remotePreviewRef.current.delete(row.id)
        canvasDiagnostics.gauge('activeRemotePreviews', remotePreviewRef.current.size)
      }
      const pending = pendingRef.current.get(row.id)
      const durablePending = durablePendingRef.current.get(row.id)
      const durableInFlight = durableInFlightRef.current.get(row.id)

      // Keep the operation observer aligned with authoritative remote state, but
      // never move it backwards over a newer local element still awaiting ACK.
      const observed = observedSceneRef.current.get(row.id)
      if (replace || isNewerVersion(nextStamp, observed)) observedSceneRef.current.set(row.id, nextStamp)

      // Equal or losing pending work has been accepted/superseded and must not
      // survive merely because this authoritative row was already observed.
      if (pending && !shouldKeepPending(stampOf(pending), nextStamp)) pendingRef.current.delete(row.id)
      if (durablePending && !shouldKeepPending(stampOf(durablePending), nextStamp)) durablePendingRef.current.delete(row.id)
      if (durableInFlight && !shouldKeepPending(stampOf(durableInFlight), nextStamp)) {
        durableInFlightRef.current.delete(row.id)
        recoveryChanged = true
      }
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)

      const rendered = localById.get(row.id)
      if (!replace && !shouldApplyAuthoritativeChange(
        nextStamp,
        shadowRef.current.get(row.id),
        rendered ? stampOf(rendered) : undefined,
        pendingRef.current.has(row.id),
      )) continue

      if (!replace && nextStamp.isDeleted && rendered && !rendered.isDeleted) {
        canvasDiagnostics.increment('authoritativeTombstoneReplays')
      }

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
        const currentLocal = localById.get(row.id)
        if (currentLocal) {
          const currentStamp = stampOf(currentLocal)
          if (currentStamp.version === nextStamp.version
            && currentStamp.versionNonce === nextStamp.versionNonce
            && currentStamp.isDeleted === nextStamp.isDeleted) {
            shadowRef.current.set(row.id, nextStamp)
            sceneVersionIndexRef.current.mark([currentLocal], isAllowedElement)
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

    if (recoveryChanged) void persistRecoveryState()
    const durableQueueSize = durablePendingRef.current.size
    patchSyncRuntime({
      queuedChanges: durableQueueSize,
      ...(durableQueueSize === 0 && !writeInFlightRef.current && syncRuntimeRef.current.saveIssue === 'retrying' ? { saveIssue: 'none' as const } : {}),
    })
    if (!changed) return
    const reconciled = enforceAuthoritativeTombstones(
      reconcileElements(
        localElements as Parameters<typeof reconcileElements>[0],
        remoteElements as unknown as Parameters<typeof reconcileElements>[1],
        editor.getAppState(),
      ) as SceneElement[],
      remoteElements,
    )
    applyingRemote.current = true
    editor.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER })
    ensureAssetsForElements(reconciled as SceneElement[])
    if (replace) {
      sceneVersionIndexRef.current.replace(reconciled as SceneElement[], isAllowedElement)
      localSceneSnapshotRef.current = indexSceneById(reconciled as SceneElement[])
    } else {
      sceneVersionIndexRef.current.mark(remoteElements, isAllowedElement)
      for (const element of remoteElements) localSceneSnapshotRef.current.set(element.id, element)
    }
    queueMicrotask(() => { applyingRemote.current = false })
  }, [ensureAssetsForElements, patchSyncRuntime, persistRecoveryState])

  useEffect(() => {
    applyAuthoritativeRowsRef.current = values => applyRows(values)
    return () => { applyAuthoritativeRowsRef.current = () => {} }
  }, [applyRows])

  const loadAuthoritative = useCallback(async (isCurrent: () => boolean = () => true, mode: 'initial' | 'reconcile' = 'initial') => {
    if (!pageActiveRef.current) return
    const startedAt = performance.now()
    const startAfter = mode === 'reconcile' ? reconciliationCursorRef.current : 0
    const initialRows: SyncRow[] = []
    const result = await readRevisionPages<SyncRow>({
      startAfter,
      pageSize: ANTI_ENTROPY_PAGE_SIZE,
      isCurrent,
      fetchPage: async (afterRevision, limit) => {
        const queryStartedAt = performance.now()
        const { data, error } = await supabase.from(config.tableName)
          .select('id,version,version_nonce,is_deleted,element,revision')
          .gt('revision', afterRevision)
          .order('revision', { ascending: true })
          .limit(limit)
          .abortSignal(AbortSignal.timeout(15_000))
        if (error) throw error
        canvasDiagnostics.sample('hydrationQueryMs', performance.now() - queryStartedAt)
        return (data ?? []).map(normalizeRow).filter((row): row is SyncRow => row !== null)
      },
      onPage: rows => {
        if (!isCurrent()) return
        if (mode === 'initial') initialRows.push(...rows)
        else applyRows(rows, false)
      },
    })
    if (!result.completed || !isCurrent()) return
    if (mode === 'initial') {
      applyRows(initialRows, pendingRef.current.size === 0)
      canvasDiagnostics.gauge('initialHydrationPages', result.pages)
      canvasDiagnostics.gauge('initialHydrationRows', result.rows)
      canvasDiagnostics.increment('initialHydrationSceneCommits')
      canvasDiagnostics.sample('initialHydrationMs', performance.now() - startedAt)
    }
    reconciliationCursorRef.current = result.cursor
    canvasDiagnostics.gauge('reconciliationCursor', result.cursor)
    if (mode === 'reconcile') {
      canvasDiagnostics.increment('antiEntropyRowsRead', result.rows)
      canvasDiagnostics.sample('antiEntropyMs', performance.now() - startedAt)
    }
  }, [applyRows, config.tableName, supabase])

  const restoreRecoveryState = useCallback(async () => {
    if (recoveryLoadedRef.current) return
    recoveryLoadedRef.current = true
    const journal = await readRecoveryJournal(config.tableName, identityRef.current.deviceId)
    if (!journal) return

    const authority = new Map<string, VersionStamp>()
    for (const [id, element] of authoritativeElementsRef.current) authority.set(id, stampOf(element))
    const candidates = recoveryCandidates(journal, authority)
      .filter(candidate => isAllowedElement(candidate as unknown as SceneElement))
      .map(candidate => candidate as unknown as SceneElement)

    if (!candidates.length) {
      await clearRecoveryJournal(config.tableName, identityRef.current.deviceId)
      canvasDiagnostics.gauge('recoveryJournalElements', 0)
      return
    }

    const editor = apiRef.current
    if (!editor || !pageActiveRef.current) return
    const recoveredById = new Map(candidates.map(element => [element.id, element]))
    const current = editor.getSceneElementsIncludingDeleted()
    const merged = current.map(element => recoveredById.get(element.id) ?? element)
    const existing = new Set(current.map(element => element.id))
    for (const element of candidates) if (!existing.has(element.id)) merged.push(element)

    applyingRemote.current = true
    editor.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
    sceneVersionIndexRef.current.replace(merged, isAllowedElement)
    localSceneSnapshotRef.current = indexSceneById(merged)
    for (const element of candidates) {
      const nextStamp = stampOf(element)
      pendingRef.current.set(element.id, element)
      durablePendingRef.current.set(element.id, element)
      observedSceneRef.current.set(element.id, nextStamp)
    }
    canvasDiagnostics.increment('recoveryJournalRestores')
    canvasDiagnostics.increment('recoveryJournalElementsRestored', candidates.length)
    canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
    patchSyncRuntime({ queuedChanges: durablePendingRef.current.size, localEditing: false })
    notify(`Recovered ${candidates.length} unsaved local change${candidates.length === 1 ? '' : 's'} after the previous interruption.`)
    queueMicrotask(() => { applyingRemote.current = false })
    await persistRecoveryState()
  }, [config.tableName, notify, patchSyncRuntime, persistRecoveryState])

  const reconcileAuthoritative = useCallback(async () => {
    if (reconciliationInFlightRef.current || !pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || continuousOperationRef.current) return
    reconciliationInFlightRef.current = true
    canvasDiagnostics.increment('antiEntropyRuns')
    try {
      await loadAuthoritative(() => pageActiveRef.current && statusRef.current === 'Live' && navigator.onLine, 'reconcile')
      if (syncRuntimeRef.current.saveIssue === 'unconfirmed' && !writeInFlightRef.current && durablePendingRef.current.size === 0) patchSyncRuntime({ saveIssue: 'none' })
      canvasDiagnostics.increment('antiEntropySuccesses')
    } catch {
      canvasDiagnostics.increment('antiEntropyFailures')
    } finally {
      reconciliationInFlightRef.current = false
    }
  }, [loadAuthoritative, patchSyncRuntime])

  const flushDurablePending = useCallback(async () => {
    if (writeInFlightRef.current || !pageActiveRef.current || statusRef.current !== 'Live' || !navigator.onLine || durablePendingRef.current.size === 0) return
    writeInFlightRef.current = true
    const elements = Array.from(durablePendingRef.current.values()).filter(isPersistableCanvasElement)
    durablePendingRef.current.clear()
    for (const element of elements) durableInFlightRef.current.set(element.id, element)
    canvasDiagnostics.gauge('durableQueueElements', 0)
    patchSyncRuntime({ queuedChanges: 0, writeInFlight: true })
    await persistRecoveryState()

    const requeueAttempt = () => {
      for (const element of elements) {
        durableInFlightRef.current.delete(element.id)
        const queued = durablePendingRef.current.get(element.id)
        if (!queued || isNewerVersion(stampOf(element), stampOf(queued))) durablePendingRef.current.set(element.id, element)
      }
      void persistRecoveryState()
      canvasDiagnostics.gauge('durableQueueElements', durablePendingRef.current.size)
    }

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
      const { error } = await supabase
        .from(config.tableName)
        .upsert(rows, { onConflict: 'id' })
        .abortSignal(AbortSignal.timeout(DURABLE_REQUEST_TIMEOUT_MS))
      if (error) {
        requeueAttempt()
        patchSyncRuntime({ queuedChanges: durablePendingRef.current.size, saveIssue: saveIssueAfterDurableAttempt(assetUploadFailuresRef.current.size, 'retrying') })
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
      const { data, error: readError } = await supabase
        .from(config.tableName)
        .select('id,version,version_nonce,is_deleted,element,revision')
        .in('id', ids)
        .abortSignal(AbortSignal.timeout(DURABLE_REQUEST_TIMEOUT_MS))
      if (!pageActiveRef.current) return
      if (readError) {
        // Keep the in-flight journal until anti-entropy confirms whether the
        // accepted write became authoritative.
        void persistRecoveryState()
        patchSyncRuntime({ saveIssue: saveIssueAfterDurableAttempt(assetUploadFailuresRef.current.size, 'unconfirmed') })
        notify(`Canvas saved, but could not confirm the latest state: ${readError.message}`)
        void reconcileAuthoritative()
        return
      }
      applyRows(data ?? [])
      for (const element of elements) durableInFlightRef.current.delete(element.id)
      void persistRecoveryState()
      patchSyncRuntime({ saveIssue: saveIssueAfterDurableAttempt(assetUploadFailuresRef.current.size, 'none') })
    } catch (error) {
      // A transport/runtime failure (including the bounded AbortSignal timeout)
      // must restore the exact attempted versions into the retry queue.
      requeueAttempt()
      patchSyncRuntime({ queuedChanges: durablePendingRef.current.size, saveIssue: saveIssueAfterDurableAttempt(assetUploadFailuresRef.current.size, 'retrying') })
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
      patchSyncRuntime({ writeInFlight: false, queuedChanges: durablePendingRef.current.size })
      if (pageActiveRef.current && statusRef.current === 'Live' && navigator.onLine && durablePendingRef.current.size && !flushTimer.current) {
        flushTimer.current = setTimeout(() => { flushTimer.current = null; void flushDurablePending() }, OPERATION_FLUSH_DELAY_MS)
      }
    }
  }, [applyRows, config.tableName, loadAuthoritative, notify, patchSyncRuntime, persistRecoveryState, reconcileAuthoritative, supabase, transition])

  const scheduleFlush = useCallback((delayMs = RECONNECT_FLUSH_DELAY_MS) => {
    if (!pageActiveRef.current || flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      void flushDurablePending()
    }, delayMs)
  }, [flushDurablePending])

  const retryConnectionNow = useCallback(() => {
    if (!navigator.onLine) return
    retryDelayRef.current = 1200
    transition('Reconnecting')
    setConnectionAttempt(value => value + 1)
  }, [transition])

  const retrySaveNow = useCallback(() => {
    if (!navigator.onLine || statusRef.current !== 'Live' || writeInFlightRef.current) return
    retryFailedAssets()
    if (durablePendingRef.current.size === 0) return
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    void flushDurablePending()
  }, [flushDurablePending, retryFailedAssets])

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
          if (!isPersistableCanvasElement(element) || !isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
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
          patchSyncRuntime({ queuedChanges: durablePendingRef.current.size })
          void flushDurablePending()
        }
      }
      if (continuousOperationRef.current) checkpointTimer.current = setTimeout(checkpoint, LONG_OPERATION_CHECKPOINT_MS)
    }
    checkpointTimer.current = setTimeout(checkpoint, LONG_OPERATION_CHECKPOINT_MS)
  }, [clearLongOperationCheckpoint, flushDurablePending, operationTracker, patchSyncRuntime])

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
    if (status === 'Live') retryFailedAssets()
  }, [retryFailedAssets, scheduleFlush, status])

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
    let remoteChanged = false
    for (const [deviceId, remote] of remoteCollaborationRef.current) {
      const person = active.get(deviceId)
      if (!person) {
        remoteCollaborationRef.current.delete(deviceId)
        collaborationSequenceGateRef.current.remove(deviceId)
        collaborationEffectGateRef.current.remove(deviceId)
        if (followDeviceIdRef.current === deviceId) {
          followDeviceIdRef.current = null
          setFollowDeviceId(null)
        }
        remoteChanged = true
      } else if (remote.displayName !== person.displayName || remote.color !== person.color) {
        remoteCollaborationRef.current.set(deviceId, { ...remote, displayName: person.displayName, color: person.color })
        remoteChanged = true
      }
    }
    if (remoteChanged) publishRemoteCollaboration()
    setPeople(Array.from(active.values()).sort((a, b) => a.displayName.localeCompare(b.displayName)))
    apiRef.current?.updateScene({ collaborators: new Map(collaboratorsRef.current) })
  }, [publishRemoteCollaboration])

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
      remoteCollaborationRef.current.clear()
      collaborationSequenceGateRef.current.clear()
      collaborationEffectGateRef.current.clear()
      setRemoteCollaboration([])
      setCollaborationEffects([])
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
        .on('broadcast', { event: 'collab-state' }, message => {
          if (isCurrent()) applyCollaborationState(message.payload)
        })
        .on('broadcast', { event: 'collab-effect' }, message => {
          if (isCurrent()) applyCollaborationEffect(message.payload)
        })
        .on('broadcast', { event: 'cursor' }, message => {
          if (!isCurrent()) return
          const payload = message.payload as Partial<CursorPayload>
          if (!payload.deviceId || payload.deviceId === identityRef.current.deviceId) return
          const socketId = payload.deviceId as SocketId
          const existing = collaboratorsRef.current.get(socketId)
          collaboratorsRef.current.set(socketId, {
            ...existing,
            username: cleanName(payload.displayName ?? 'Guest'),
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
              .then(async () => {
                if (!stillCurrent()) return
                await restoreRecoveryState()
                if (!stillCurrent()) return
                retryDelayRef.current = 1200
                transition('Live')
                if (syncRuntimeRef.current.saveIssue === 'unconfirmed' && durablePendingRef.current.size === 0) patchSyncRuntime({ saveIssue: 'none' })
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
  }, [api, applyCollaborationEffect, applyCollaborationState, applyRemotePreview, applyRows, clearRemotePreviews, config.tableName, connectionAttempt, identity.deviceId, loadAuthoritative, notify, patchSyncRuntime, restoreRecoveryState, scheduleFlush, supabase, syncPresence, transition])

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
    void channel.track({ deviceId: identity.deviceId, displayName: identity.displayName, color: identity.color, sessionId: collaborationSessionIdRef.current, onlineAt: new Date().toISOString() }).catch(() => {})
    queueCollaborationStateRef.current(true)
  }, [identity, status])

  useEffect(() => {
    if (status !== 'Live') return
    queueCollaborationStateRef.current(true)
    const timer = window.setInterval(() => queueCollaborationStateRef.current(true), COLLABORATION_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [status])

  const syncSelectionUi = useCallback((elements: readonly SceneElement[], appState: AppState) => {
    const selected = elements.filter(element => !element.isDeleted && appState.selectedElementIds[element.id])
    const selectedGroupIds = { ...appState.selectedGroupIds }
    const selectedFrames = new Set(selected.filter(element => element.type === 'frame').map(element => element.id))
    const selectedFrameContents = selectedFrames.size
      ? elements.filter(element => !element.isDeleted && element.frameId && selectedFrames.has(element.frameId))
      : []
    const signature = [
      selected.map(element => `${element.id}:${element.version}`).join(','),
      selectedFrameContents.map(element => `${element.id}:${element.version}`).sort().join(','),
      Object.entries(selectedGroupIds).filter(([, value]) => value).map(([id]) => id).sort().join(','),
      appState.editingGroupId ?? '',
      appState.objectsSnapModeEnabled ? '1' : '0',
      gridModeEnabled ? '1' : '0',
    ].join('|')
    if (signature !== selectionSignatureRef.current) {
      selectionSignatureRef.current = signature
      setSelectionSnapshot({ elements: [...selected], selectedGroupIds, editingGroupId: appState.editingGroupId, objectsSnapModeEnabled: appState.objectsSnapModeEnabled, gridModeEnabled })
      queueCollaborationStateRef.current()
    }
    const locked = elements.some(element => !element.isDeleted && element.locked)
    setHasLockedElements(previous => previous === locked ? previous : locked)
  }, [gridModeEnabled])

  const refreshSelectionUi = useCallback(() => {
    const editor = apiRef.current
    if (!editor) return
    syncSelectionUi(editor.getSceneElementsIncludingDeleted(), editor.getAppState())
  }, [syncSelectionUi])

  const refreshCanvasSelectionOverlays = useCallback(() => {
    const editor = apiRef.current
    if (!editor) return
    const elements = editor.getSceneElementsIncludingDeleted()
    const appState = editor.getAppState()
    syncSelectionUi(elements, appState)
    richTextLayerRef.current?.sync(elements, appState)
  }, [syncSelectionUi])

  const refreshSelectionAfterInteraction = useCallback(() => {
    requestAnimationFrame(refreshSelectionUi)
  }, [refreshSelectionUi])

  const refreshNavigationUi = useCallback(() => {
    const editor = apiRef.current
    if (!editor) return
    const appState = editor.getAppState()
    navigationRef.current?.sync(editor.getSceneElementsIncludingDeleted(), appState)
    backdropRef.current?.sync(appState)
    setViewportRevision(value => value + 1)
    queueCollaborationStateRef.current()
  }, [])

  useEffect(() => {
    const keyup = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      requestAnimationFrame(() => {
        refreshSelectionUi()
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) captureCurrentScene()
      })
    }
    document.addEventListener('keyup', keyup, true)
    return () => document.removeEventListener('keyup', keyup, true)
  }, [captureCurrentScene, refreshSelectionUi, resolvedTheme])

  const onChange = useCallback((elements: readonly SceneElement[], appState: AppState, files: BinaryFiles) => {
    observeLocalFiles(files, elements)
    richTextLayerRef.current?.sync(elements, appState)
    shapeLayerRef.current?.sync(elements, appState)
    navigationRef.current?.sync(elements, appState)
    backdropRef.current?.sync(appState)
    syncSelectionUi(elements, appState)
    if (applyingRemote.current || statusRef.current !== 'Live') return
    const previousEditingTextId = editingTextRef.current
    const nextEditingTextId = appState.editingTextElement?.id ?? null
    if (nextEditingTextId && nextEditingTextId !== previousEditingTextId) {
      if (previousEditingTextId) operationTracker.endText()
      continuousOperationRef.current = 'text'
      operationTracker.beginText()
      patchSyncRuntime({ localEditing: true })
      setCollaborationActivity('typing')
      armCheckpointRef.current()
    }
    const observationStarted = performance.now()
    const observationNow = Date.now()
    const observation = sceneVersionIndexRef.current.observe(
      elements,
      isAllowedElement,
      element => (previewEchoStampsRef.current.get(element.id)?.get(previewStampKey(stampOf(element))) ?? 0) > observationNow,
    )
    canvasDiagnostics.increment('sceneObservationCallbacks')
    canvasDiagnostics.increment('sceneElementsScanned', observation.scanned)
    canvasDiagnostics.increment('sceneElementsStampSkipped', observation.skipped)
    canvasDiagnostics.increment('sceneElementsChanged', observation.changed.length)
    if (observation.ignored) {
      canvasDiagnostics.increment('previewEchoesSuppressed', observation.ignored)
      canvasDiagnostics.increment('sceneElementsIgnored', observation.ignored)
    }
    canvasDiagnostics.sample('sceneObservationMs', performance.now() - observationStarted)
    if (observation.hasDisallowed) {
      const allowed = elements.filter(isAllowedElement)
      notify('Unsupported embeds and file-backed objects were removed. Canvas supports vector objects and images.')
      applyingRemote.current = true
      apiRef.current?.updateScene({ elements: allowed, captureUpdate: CaptureUpdateAction.NEVER })
      sceneVersionIndexRef.current.replace(allowed, isAllowedElement)
      queueMicrotask(() => { applyingRemote.current = false })
    }
    for (const element of observation.changed) {
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
        if (!ownUndoBeforeRef.current.has(element.id)) ownUndoBeforeRef.current.set(element.id, localSceneSnapshotRef.current.get(element.id) ?? null)
        operationTracker.record(element, observed !== undefined)
        observedSceneRef.current.set(element.id, nextStamp)
      }
      localSceneSnapshotRef.current.set(element.id, element)

      // Keep intermediate local states in memory so remote echoes cannot
      // clobber an active gesture. Phase 3 changes the durability boundary, not
      // this conflict-protection watermark: network persistence starts only
      // when the logical CanvasMutation commits (or at a long-op checkpoint).
      if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
      const queued = pendingRef.current.get(element.id)
      if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
      patchSyncRuntime({ localEditing: true })
    }
    const activeSnapshot = operationTracker.snapshotActive()
    if (activeSnapshot && (activeSnapshot.source === 'pointer' || activeSnapshot.source === 'text')) {
      queuePreview(activeSnapshot.source, activeSnapshot.changes.map(change => change.type === 'delete' ? change.tombstone : change.element))
    }
    if (previousEditingTextId && !nextEditingTextId) {
      continuousOperationRef.current = null
      patchSyncRuntime({ localEditing: false })
      clearCheckpointRef.current()
      operationTracker.endText()
      setCollaborationActivity('idle')
    }
    editingTextRef.current = nextEditingTextId
  }, [notify, observeLocalFiles, operationTracker, patchSyncRuntime, queuePreview, setCollaborationActivity, syncSelectionUi])

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'up' | 'down' }) => {
    if (statusRef.current !== 'Live') return
    latestLocalPointerRef.current = { ...payload.pointer, button: payload.button }
    const now = performance.now()
    if (now - cursorAt.current < COLLABORATION_BROADCAST_INTERVAL_MS && payload.button !== 'down' && payload.pointer.tool !== 'laser') return
    cursorAt.current = now
    queueCollaborationStateRef.current(payload.button === 'down' || payload.pointer.tool === 'laser')
  }, [])

  const rename = (value: string) => {
    const next = { ...identity, displayName: cleanName(value) }
    setIdentity(next)
    if (!saveIdentity(storage, next)) notify('Browser storage is unavailable. This name lasts until the tab closes.')
  }
  const feedback = useCallback((kind: 'tap' | 'soft' | 'success' | 'sparkle') => {
    const profile = visualProfileRef.current
    performHaptic(profile.haptics, kind)
    performTone(profile.sounds, kind)
  }, [])

  const changeTheme = useCallback((next: ThemePreference) => {
    setTheme(next)
    writePreference(storage, 'canvas.theme.v1', next)
    feedback('soft')
  }, [feedback, storage])

  const changeVisualProfile = useCallback((next: CanvasVisualProfile) => {
    const previous = visualProfileRef.current
    visualProfileRef.current = next
    setVisualProfile(next)
    saveVisualProfile(storage, next)
    if (next.gridPattern !== previous.gridPattern) {
      const visible = next.gridPattern !== 'none'
      setGridModeEnabled(visible)
      writePreference(storage, 'canvas.grid-mode.v1', String(visible))
    }
    const discreteChanged =
      next.accent !== previous.accent
      || next.paper !== previous.paper
      || next.gridPattern !== previous.gridPattern
      || next.motion !== previous.motion
      || next.sounds !== previous.sounds
      || next.haptics !== previous.haptics
      || next.ambientGlow !== previous.ambientGlow
    if (discreteChanged) feedback('soft')
    requestAnimationFrame(() => {
      const editor = apiRef.current
      if (editor) backdropRef.current?.sync(editor.getAppState())
    })
  }, [feedback, storage])

  const triggerDelight = useCallback(() => {
    setDelightBurst(value => value + 1)
    feedback('sparkle')
  }, [feedback])

  const rememberShowRemoteCursors = (value: boolean) => {
    setShowRemoteCursors(value)
    writePreference(storage, 'canvas.show-remote-cursors.v1', String(value))
  }
  const rememberShareCursor = (value: boolean) => {
    shareCursorRef.current = value
    setShareCursor(value)
    writePreference(storage, 'canvas.share-cursor.v1', String(value))
    queueCollaborationStateRef.current(true)
  }
  const sendPing = (deviceId: string) => {
    feedback('tap')
    sendCollaborationEffect('ping', null, deviceId)
  }
  const sendReaction = (emoji: CollaborationReaction) => {
    feedback(emoji === '✨' || emoji === '🎉' ? 'sparkle' : 'soft')
    if (emoji === '✨' || emoji === '🎉') setDelightBurst(value => value + 1)
    sendCollaborationEffect('reaction', emoji)
  }
  const recordRichTextDraft = useCallback((element: SceneElement) => {
    if (statusRef.current !== 'Live') return
    const nextStamp = stampOf(element)
    const observed = observedSceneRef.current.get(element.id)
    if (isNewerVersion(nextStamp, observed)) {
      operationTracker.record(element, observed !== undefined)
      observedSceneRef.current.set(element.id, nextStamp)
    }
    if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) return
    const queued = pendingRef.current.get(element.id)
    if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
    patchSyncRuntime({ localEditing: true })
    const activeSnapshot = operationTracker.snapshotActive()
    if (activeSnapshot?.source === 'text') {
      queuePreview('text', activeSnapshot.changes.map(change => change.type === 'delete' ? change.tombstone : change.element))
    }
  }, [operationTracker, patchSyncRuntime, queuePreview])

  const beginRichTextOperation = useCallback(() => {
    if (statusRef.current !== 'Live') return
    continuousOperationRef.current = 'text'
    operationTracker.beginText()
    patchSyncRuntime({ localEditing: true })
    setCollaborationActivity('typing')
    armCheckpointRef.current()
  }, [operationTracker, patchSyncRuntime, setCollaborationActivity])

  const endRichTextOperation = useCallback(() => {
    if (continuousOperationRef.current !== 'text') return
    continuousOperationRef.current = null
    patchSyncRuntime({ localEditing: false })
    clearCheckpointRef.current()
    operationTracker.endText()
    setCollaborationActivity('idle')
  }, [operationTracker, patchSyncRuntime, setCollaborationActivity])

  const insertCustomShape = useCallback((kind: CanvasShapeKind) => {
    setDrawingMode(null)
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    const appState = editor.getAppState()
    const zoom = Math.max(0.01, appState.zoom.value)
    const stamp = ['heart', 'check', 'sparkle', 'pin', 'flag', 'bolt'].includes(kind)
    const width = stamp ? 108 : kind === 'star' ? 140 : 180
    const height = stamp ? 108 : kind === 'star' ? 140 : kind === 'cloud' ? 115 : 120
    const centerX = appState.width / (2 * zoom) - appState.scrollX
    const centerY = appState.height / (2 * zoom) - appState.scrollY
    const shape = createCanvasShapeElement({
      kind,
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      ...(stamp ? { style: { strokeColor: accentColor(visualProfileRef.current.accent, resolvedTheme), fillStyle: 'transparent' } } : {}),
    })
    editor.updateScene({
      elements: [...editor.getSceneElementsIncludingDeleted(), shape],
      appState: { selectedElementIds: { [shape.id]: true }, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    editor.setActiveTool({ type: 'selection' })
    requestAnimationFrame(() => {
      refreshSelectionUi()
      captureCurrentScene()
    })
  }, [captureCurrentScene, refreshSelectionUi, resolvedTheme])

  const createRichTextAt = useCallback((sceneX: number, sceneY: number) => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    beginRichTextOperation()
    const richText = createRichTextElement({ x: sceneX, y: sceneY })
    const current = editor.getSceneElementsIncludingDeleted()
    editor.updateScene({
      elements: [...current, richText],
      appState: { selectedElementIds: { [richText.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    editor.setActiveTool({ type: 'selection' })
    setRichTextMode(false)
    requestAnimationFrame(() => richTextLayerRef.current?.beginEditing(richText.id))
  }, [beginRichTextOperation])

  const toggleRichTextMode = useCallback(() => {
    if (!apiRef.current || statusRef.current !== 'Live') return
    setDrawingMode(null)
    apiRef.current.setActiveTool({ type: 'selection' })
    setRichTextMode(value => !value)
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (event.key === 'Escape' && richTextMode) {
        event.preventDefault()
        event.stopPropagation()
        setRichTextMode(false)
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        event.stopPropagation()
        toggleRichTextMode()
        return
      }
      if (key === 'p' || key === 'x') {
        event.preventDefault()
        event.stopPropagation()
        setRichTextMode(false)
        setDrawingMode('pen')
        return
      }
      if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        setRichTextMode(false)
        setDrawingMode('partial-eraser')
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [richTextMode, toggleRichTextMode])

  useEffect(() => {
    if (status !== 'Live') {
      if (richTextMode) setRichTextMode(false)
      if (drawingMode) setDrawingMode(null)
    }
  }, [drawingMode, richTextMode, status])

  useEffect(() => {
    if (!api || status !== 'Live') return
    api.updateScene({
      appState: {
        objectsSnapModeEnabled,
        gridModeEnabled: gridModeEnabled && visualProfile.gridPattern === 'squares',
        gridSize: visualProfile.gridSize as AppState['gridSize'],
        viewBackgroundColor: 'transparent',
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    backdropRef.current?.sync(api.getAppState())
    requestAnimationFrame(refreshSelectionUi)
  }, [api, gridModeEnabled, objectsSnapModeEnabled, refreshSelectionUi, status, visualProfile.gridPattern, visualProfile.gridSize])

  const rememberObjectsSnap = useCallback((enabled: boolean) => {
    setObjectsSnapModeEnabled(enabled)
    setSelectionSnapshot(current => ({ ...current, objectsSnapModeEnabled: enabled }))
    writePreference(storage, 'canvas.objects-snap.v1', String(enabled))
  }, [storage])

  const rememberDrawingSetting = useCallback((key: keyof DrawingControlSettings, value: DrawingControlSettings[keyof DrawingControlSettings]) => {
    const prefKeys: Record<keyof DrawingControlSettings, string> = {
      penColor: 'canvas.pen-color.v1',
      penWidth: 'canvas.pen-width.v1',
      penOpacity: 'canvas.pen-opacity.v1',
      smoothing: 'canvas.pen-smoothing.v1',
      pressure: 'canvas.pen-pressure.v1',
      highlighterColor: 'canvas.highlighter-color.v1',
      highlighterWidth: 'canvas.highlighter-width.v1',
      eraserRadius: 'canvas.stroke-eraser-radius.v1',
      holdToClean: 'canvas.hold-clean.v1',
      stylusMode: 'canvas.stylus-mode.v1',
    }
    setDrawingSettings(current => ({ ...current, [key]: value } as DrawingControlSettings))
    writePreference(storage, prefKeys[key], String(value))
  }, [storage])

  const deactivateDrawing = useCallback(() => {
    setDrawingMode(null)
  }, [])

  const activateLaserPointer = useCallback(() => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    setRichTextMode(false)
    setDrawingMode(null)
    editor.setActiveTool({ type: 'laser' })
  }, [])

  const activateDrawingMode = useCallback((mode: DrawingMode) => {
    if (!apiRef.current || statusRef.current !== 'Live') return
    setRichTextMode(false)
    setDrawingMode(mode)
  }, [])

  useEffect(() => {
    const editor = apiRef.current
    if (!editor || status !== 'Live' || !drawingMode) return
    const current = editor.getAppState()
    if (drawingMode === 'pen' || drawingMode === 'highlighter') {
      const width = drawingMode === 'pen' ? drawingSettings.penWidth : drawingSettings.highlighterWidth
      editor.setActiveTool({ type: 'freedraw', locked: true })
      editor.updateScene({
        appState: {
          currentItemStrokeColor: drawingMode === 'pen' ? drawingSettings.penColor : drawingSettings.highlighterColor,
          currentItemBackgroundColor: 'transparent',
          currentItemFillStyle: 'solid',
          currentItemStrokeWidth: width,
          currentItemStrokeStyle: 'solid',
          currentItemRoughness: 0,
          currentItemOpacity: drawingMode === 'pen' ? drawingSettings.penOpacity : 32,
          penMode: drawingSettings.stylusMode,
          penDetected: drawingSettings.stylusMode || current.penDetected,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
      return
    }
    editor.updateScene({
      appState: {
        penMode: drawingSettings.stylusMode,
        penDetected: drawingSettings.stylusMode || current.penDetected,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    editor.setActiveTool({ type: drawingMode === 'partial-eraser' ? 'hand' : 'eraser', locked: true })
  }, [drawingMode, drawingSettings, status])

  const cleanRecognitionElement = useCallback((stroke: SceneElement, recognition: ReturnType<typeof recognizeHeldStroke>) => {
    if (!recognition) return null
    const shared = {
      strokeColor: stroke.strokeColor,
      strokeWidth: stroke.strokeWidth,
      strokeStyle: 'solid' as const,
      roughness: 0,
      opacity: stroke.opacity,
    }
    let cleaned: SceneElement | undefined
    if (recognition.kind === 'line') {
      const dx = recognition.end[0] - recognition.start[0]
      const dy = recognition.end[1] - recognition.start[1]
      ;[cleaned] = convertToExcalidrawElements([{
        type: 'line',
        x: recognition.start[0],
        y: recognition.start[1],
        points: [[0, 0], [dx, dy]],
        ...shared,
      }]) as unknown as SceneElement[]
    } else {
      ;[cleaned] = convertToExcalidrawElements([{
        type: recognition.kind,
        x: recognition.x,
        y: recognition.y,
        width: recognition.width,
        height: recognition.height,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        ...shared,
      }]) as unknown as SceneElement[]
    }
    if (!cleaned) return null
    const strokeData = (stroke as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
    return {
      ...cleaned,
      index: stroke.index,
      frameId: stroke.frameId,
      groupIds: stroke.groupIds,
      customData: {
        ...cleaned.customData,
        ...strokeData,
        canvasDrawing: {
          ...(strokeData.canvasDrawing as Record<string, unknown> | undefined),
          cleaned: true,
          cleanedFrom: stroke.id,
        },
      },
    } as SceneElement
  }, [])

  const finishDrawingGesture = useCallback((gesture: NonNullable<typeof drawingGestureRef.current>, heldForMs: number) => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    const scene = editor.getSceneElementsIncludingDeleted()
    const created = [...scene]
      .reverse()
      .find(element => element.type === 'freedraw' && !element.isDeleted && !gesture.beforeIds.has(element.id))
    if (!created || created.type !== 'freedraw') return
    const settings = drawingSettingsRef.current
    const styled = finalizeFreeDrawElement(created as unknown as DrawingElementLike, {
      mode: gesture.mode,
      color: gesture.mode === 'pen' ? settings.penColor : settings.highlighterColor,
      width: gesture.mode === 'pen' ? settings.penWidth : settings.highlighterWidth,
      smoothing: settings.smoothing,
      pressure: gesture.mode === 'pen' ? settings.pressure : false,
      opacity: gesture.mode === 'pen' ? settings.penOpacity : 32,
    }) as unknown as SceneElement

    let next = scene.map(element => element.id === styled.id ? styled : element)
    if (isAccidentalTinyStroke(styled as unknown as DrawingElementLike)) {
      const tombstone = newElementWith(styled, { isDeleted: true })
      next = next.map(element => element.id === styled.id ? tombstone : element)
    } else if (gesture.mode === 'pen' && settings.holdToClean && heldForMs >= 380) {
      const recognition = recognizeHeldStroke(styled as unknown as DrawingElementLike)
      const cleaned = cleanRecognitionElement(styled, recognition)
      if (cleaned) {
        const tombstone = newElementWith(styled, { isDeleted: true })
        next = next.map(element => element.id === styled.id ? tombstone : element)
        next.push(cleaned)
      }
    } else if (gesture.mode === 'highlighter') {
      next = reorderSelection(next as unknown as CanvasElementLike[], new Set([styled.id]), 'back') as unknown as SceneElement[]
    }

    editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    requestAnimationFrame(captureCurrentScene)
  }, [captureCurrentScene, cleanRecognitionElement])

  const rememberGridMode = useCallback((enabled: boolean) => {
    setGridModeEnabled(enabled)
    setSelectionSnapshot(current => ({ ...current, gridModeEnabled: enabled }))
    writePreference(storage, 'canvas.grid-mode.v1', String(enabled))
    if (enabled && visualProfileRef.current.gridPattern === 'none') {
      const next = { ...visualProfileRef.current, gridPattern: 'dots' as const }
      visualProfileRef.current = next
      setVisualProfile(next)
      saveVisualProfile(storage, next)
    }
    feedback('tap')
  }, [feedback, storage])

  const scenePointFromPointer = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const editor = apiRef.current
    if (!editor) return null
    const appState = editor.getAppState()
    const rect = target.getBoundingClientRect()
    const zoom = Math.max(0.01, appState.zoom.value)
    return {
      x: (clientX - rect.left) / zoom - appState.scrollX,
      y: (clientY - rect.top) / zoom - appState.scrollY,
    }
  }

  const handleRichTextPlacement = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!richTextMode || event.button !== 0) return
    const point = scenePointFromPointer(event.clientX, event.clientY, event.currentTarget)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    createRichTextAt(point.x, point.y)
  }

  const handleDrawingPointerDown = (event: React.PointerEvent<HTMLDivElement>): boolean => {
    const editor = apiRef.current
    const mode = drawingModeRef.current
    if (!editor || !mode || statusRef.current !== 'Live') return false

    if (event.pointerType === 'pen') penPointersRef.current.add(event.pointerId)
    if (event.pointerType === 'touch') {
      touchPointersRef.current.add(event.pointerId)
      if (drawingSettingsRef.current.stylusMode && touchPointersRef.current.size >= 2 && penPointersRef.current.size === 0) {
        editor.updateScene({ appState: { penMode: false }, captureUpdate: CaptureUpdateAction.NEVER })
      }
    }

    if (mode === 'partial-eraser') {
      if (drawingSettingsRef.current.stylusMode && event.pointerType === 'touch') return false
      if (event.button !== 0) return false
      const point = scenePointFromPointer(event.clientX, event.clientY, event.currentTarget)
      if (!point) return false
      const rect = event.currentTarget.getBoundingClientRect()
      const zoom = Math.max(0.01, editor.getAppState().zoom.value)
      partialEraserRef.current = { pointerId: event.pointerId, path: [[point.x, point.y]] }
      setEraserPreview({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        radius: drawingSettingsRef.current.eraserRadius * zoom,
      })
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    if ((mode === 'pen' || mode === 'highlighter') && event.button === 0) {
      if (drawingSettingsRef.current.stylusMode && event.pointerType === 'touch') return false
      drawingGestureRef.current = {
        pointerId: event.pointerId,
        mode,
        beforeIds: new Set(editor.getSceneElementsIncludingDeleted().filter(element => element.type === 'freedraw' && !element.isDeleted).map(element => element.id)),
        lastMoveAt: performance.now(),
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      }
    }
    return false
  }

  const handleDrawingPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const eraser = partialEraserRef.current
    if (eraser?.pointerId === event.pointerId) {
      const point = scenePointFromPointer(event.clientX, event.clientY, event.currentTarget)
      const editor = apiRef.current
      if (!point || !editor) return
      const previous = eraser.path.at(-1)
      if (!previous || Math.hypot(point.x - previous[0], point.y - previous[1]) >= 1) eraser.path.push([point.x, point.y])
      const rect = event.currentTarget.getBoundingClientRect()
      setEraserPreview({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        radius: drawingSettingsRef.current.eraserRadius * Math.max(0.01, editor.getAppState().zoom.value),
      })
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const gesture = drawingGestureRef.current
    if (gesture?.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.lastClientX, event.clientY - gesture.lastClientY) >= 0.7) {
      gesture.lastMoveAt = performance.now()
      gesture.lastClientX = event.clientX
      gesture.lastClientY = event.clientY
    }
  }

  const restoreStylusModeAfterPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'pen') penPointersRef.current.delete(event.pointerId)
    if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId)
    if (drawingSettingsRef.current.stylusMode && touchPointersRef.current.size < 2) {
      requestAnimationFrame(() => {
        const editor = apiRef.current
        if (!editor || statusRef.current !== 'Live' || !drawingModeRef.current) return
        editor.updateScene({ appState: { penMode: true, penDetected: true }, captureUpdate: CaptureUpdateAction.NEVER })
      })
    }
  }

  const handleDrawingPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const eraser = partialEraserRef.current
    if (eraser?.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      partialEraserRef.current = null
      setEraserPreview(null)
      const editor = apiRef.current
      if (editor && eraser.path.length) {
        const result = eraseFreeDrawWithPath(
          editor.getSceneElementsIncludingDeleted() as unknown as DrawingElementLike[],
          eraser.path,
          drawingSettingsRef.current.eraserRadius,
        )
        if (result.affected) {
          editor.updateScene({ elements: result.elements as unknown as SceneElement[], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
          requestAnimationFrame(captureCurrentScene)
        }
      }
      restoreStylusModeAfterPointer(event)
      return
    }

    const gesture = drawingGestureRef.current
    if (gesture?.pointerId === event.pointerId) {
      drawingGestureRef.current = null
      const heldForMs = performance.now() - gesture.lastMoveAt
      requestAnimationFrame(() => requestAnimationFrame(() => finishDrawingGesture(gesture, heldForMs)))
    }
    restoreStylusModeAfterPointer(event)
  }

  const handleDrawingPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (partialEraserRef.current?.pointerId === event.pointerId) partialEraserRef.current = null
    if (drawingGestureRef.current?.pointerId === event.pointerId) drawingGestureRef.current = null
    setEraserPreview(null)
    restoreStylusModeAfterPointer(event)
  }

  const handleCanvasPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (handleDrawingPointerDown(event)) return
    handleRichTextPlacement(event)
  }

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (richTextLayerRef.current?.editSelected()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    if (Object.keys(editor.getAppState().selectedElementIds).length > 0) return
    const point = scenePointFromPointer(event.clientX, event.clientY, event.currentTarget)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    createRichTextAt(point.x, point.y)
  }

  const handlePasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length || files.every(file => isSupportedImageMime(file.type))) return
    event.preventDefault()
    event.stopPropagation()
    notify('Canvas paste accepts images and text, but not arbitrary files.')
  }

  useEffect(() => {
    const editingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))

    const handleDocumentCopy = (event: ClipboardEvent) => {
      if (editingTarget(event.target)) return
      const editor = apiRef.current
      if (!editor || statusRef.current !== 'Live' || !event.clipboardData) return
      const payload = createCanvasClipboardText(editor)
      if (!payload) return
      if (payload.length > 80 * 1024 * 1024) {
        notify('This selection is too large for the cross-session clipboard. Export JSON instead.')
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      event.clipboardData.clearData()
      event.clipboardData.setData('text/plain', payload)
      event.clipboardData.setData('application/x-canvas+json', payload)
    }

    const handleDocumentPaste = (event: ClipboardEvent) => {
      if (editingTarget(event.target)) return
      if (event.clipboardData?.files.length) return

      const text = event.clipboardData?.getData('text/plain').trim()
      const editor = apiRef.current
      if (!text || !editor || statusRef.current !== 'Live') return

      if (isCanvasClipboardText(text)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void (async () => {
          try {
            const imported = await prepareCanvasJsonImport(text)
            if (!imported.elements.length) throw new Error('The clipboard contains no supported canvas objects.')
            insertElements(editor, imported.elements, imported.files)
            for (const fileData of Object.values(imported.files)) {
              void ensureUploadedAsset(fileData).catch(() => {})
            }
          } catch (error) {
            notify(`Canvas could not paste that selection: ${error instanceof Error ? error.message : String(error)}`)
          }
        })()
        return
      }

      const card = createBookmarkCard(text, editor)
      if (!card) return
      event.preventDefault()
      event.stopImmediatePropagation()
      insertElements(editor, card)
    }

    document.addEventListener('copy', handleDocumentCopy, true)
    document.addEventListener('paste', handleDocumentPaste, true)
    return () => {
      document.removeEventListener('copy', handleDocumentCopy, true)
      document.removeEventListener('paste', handleDocumentPaste, true)
    }
  }, [ensureUploadedAsset, notify])

  const addImageFile = useCallback(async (file: File) => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    try {
      const prepared = await createCanvasImage(file, editor)
      insertElements(editor, [prepared.element], { [prepared.file.id]: prepared.file } as BinaryFiles)
      await ensureUploadedAsset(prepared.file)
    } catch (error) {
      notify(`Image could not be added: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [ensureUploadedAsset, notify])

  const importCanvasFile = useCallback(async (file: File) => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    if (isSupportedImageMime(file.type)) {
      await addImageFile(file)
      return
    }
    try {
      const imported = await prepareCanvasJsonImport(await file.text())
      if (!imported.elements.length) throw new Error('The import contains no supported canvas objects.')
      insertElements(editor, imported.elements, imported.files)
      for (const fileData of Object.values(imported.files)) {
        void ensureUploadedAsset(fileData).catch(() => {})
      }
    } catch (error) {
      notify(`Canvas could not import that file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [addImageFile, ensureUploadedAsset, notify])

  const replaceImageFile = useCallback(async (elementId: string, file: File) => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    const current = editor.getSceneElementsIncludingDeleted()
    const target = current.find(element => element.id === elementId)
    if (!target || target.type !== 'image' || target.isDeleted) return
    try {
      const prepared = await createCanvasImage(file, editor)
      editor.addFiles([prepared.file])
      const replacement = newElementWith(target, { fileId: prepared.file.id, status: 'pending', crop: null })
      const next = current.map(element => element.id === elementId ? replacement : element)
      editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
      await ensureUploadedAsset(prepared.file)
    } catch (error) {
      notify(`Image could not be replaced: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [ensureUploadedAsset, notify])

  const exportCanvas = useCallback(async (format: CanvasExportFormat) => {
    const editor = apiRef.current
    if (!editor) return
    try {
      await exportCanvasScene(editor, format)
    } catch (error) {
      notify(`Canvas could not export ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [notify])

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    const importableJson = files.length === 1 && (files[0].type === 'application/json' || /\.(json|excalidraw)$/i.test(files[0].name))
    if (importableJson) {
      event.preventDefault()
      event.stopPropagation()
      void importCanvasFile(files[0])
      return
    }
    if (files.every(file => isSupportedImageMime(file.type))) return
    event.preventDefault()
    event.stopPropagation()
    notify('Drop images or a Canvas/Excalidraw JSON file.')
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        triggerDelight()
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [triggerDelight])

  const unlockAllLocked = useCallback(() => {
    const editor = apiRef.current
    if (!editor || statusRef.current !== 'Live') return
    const count = unlockAllElements(editor)
    if (count) {
      requestAnimationFrame(refreshSelectionUi)
      notify(`Unlocked ${count} object${count === 1 ? '' : 's'}.`)
    }
  }, [notify, refreshSelectionUi])

  return <div
    className="canvas-app live-canvas-app"
    data-canvas-engine="excalidraw-supabase"
    data-canvas-motion={resolvedMotion}
    data-canvas-grid={gridModeEnabled ? visualProfile.gridPattern : 'none'}
    style={visualRootStyle(visualProfile, resolvedTheme)}
  >
    <a className="skip-link" href="#shared-canvas-workspace">Skip to canvas</a>
    <p id="canvas-keyboard-instructions" className="sr-only">
      Shared infinite canvas. Use the top toolbar to choose drawing and editing tools. Press V for selection, Space for pan, T for text, and F for frame. Tab reaches Canvas-owned controls; Escape closes open menus.
    </p>
    <LiveHeader
      api={api}
      identity={identity}
      people={people}
      status={status}
      syncHealth={syncHealth}
      theme={theme}
      rename={rename}
      changeTheme={changeTheme}
      richTextMode={richTextMode}
      toggleRichText={toggleRichTextMode}
      hasLockedElements={hasLockedElements}
      unlockAll={unlockAllLocked}
      insertCustomShape={insertCustomShape}
      deactivateDrawing={deactivateDrawing}
      visualControls={<VisualControls
        theme={theme}
        profile={visualProfile}
        gridVisible={gridModeEnabled}
        disabled={!api}
        onTheme={changeTheme}
        onProfile={changeVisualProfile}
        onGridVisible={rememberGridMode}
        onDelight={triggerDelight}
      />}
      mediaControls={<MediaControls
        disabled={!api || status !== 'Live'}
        busy={syncRuntime.assetTransfers > 0}
        onAddImage={addImageFile}
        onImport={importCanvasFile}
        onExport={exportCanvas}
      />}
      collaborationPanel={<CollaborationPanel
        collaborators={remoteCollaboration}
        followDeviceId={followDeviceId}
        showRemoteCursors={showRemoteCursors}
        shareCursor={shareCursor}
        canUndo={undoDepth > 0 && !undoInFlight && syncRuntime.queuedChanges === 0 && !syncRuntime.writeInFlight && syncRuntime.saveIssue === 'none'}
        disabled={!api || status !== 'Live'}
        onJump={jumpToCollaborator}
        onFollow={toggleFollowCollaborator}
        onPing={sendPing}
        onShowRemoteCursors={rememberShowRemoteCursors}
        onShareCursor={rememberShareCursor}
        onUndo={undoMyLastAction}
        onLaser={activateLaserPointer}
        onReaction={sendReaction}
      />}
      drawingControls={<DrawingControls
        disabled={!api || status !== 'Live'}
        mode={drawingMode}
        settings={drawingSettings}
        onMode={activateDrawingMode}
        onSetting={rememberDrawingSetting}
      />}
    />
    <main
      id="shared-canvas-workspace"
      className="canvas-workspace live-canvas-workspace"
      aria-label="Shared infinite canvas"
      aria-describedby="canvas-keyboard-instructions"
      tabIndex={-1}
    >
      <CanvasBackdrop ref={backdropRef} profile={backdropProfile} theme={resolvedTheme} />
      {delightBurst > 0 && <div key={delightBurst} className="canvas-delight-burst" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => <span key={index} style={{ '--delight-index': index } as CSSProperties}>✦</span>)}
      </div>}
      <div
        className={`live-excalidraw${richTextMode ? ' rich-text-insert-mode' : ''}${drawingMode ? ` drawing-mode drawing-mode--${drawingMode}` : ''}`}
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerMoveCapture={handleDrawingPointerMove}
        onPointerUpCapture={handleDrawingPointerUp}
        onPointerCancelCapture={handleDrawingPointerCancel}
        onDoubleClickCapture={handleCanvasDoubleClick}
        onPasteCapture={handlePasteCapture}
        onDropCapture={handleDrop}
        onDragOverCapture={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}>
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={onChange}
          generateIdForFile={generateCanvasFileId}
          onPointerUpdate={onPointerUpdate}
          onPointerUp={refreshSelectionAfterInteraction}
          onScrollChange={() => requestAnimationFrame(refreshNavigationUi)}
          theme={resolvedTheme}
          viewModeEnabled={status !== 'Live'}
          objectsSnapModeEnabled={objectsSnapModeEnabled}
          gridModeEnabled={gridModeEnabled && visualProfile.gridPattern === 'squares'}
          handleKeyboardGlobally
          isCollaborating={status === 'Live'}
          UIOptions={UI_OPTIONS}
          aiEnabled={false}
          name="Canvas"
          langCode="en"
        >
          <MainMenu />
          <DefaultSidebar.Trigger style={{ display: 'none' }} aria-hidden="true" />
        </Excalidraw>
        <CanvasShapeLayer ref={shapeLayerRef} />
        <CollaborationOverlay
          api={api}
          collaborators={remoteCollaboration}
          effects={collaborationEffects}
          showCursors={showRemoteCursors}
          followDeviceId={followDeviceId}
          viewportRevision={viewportRevision}
          onStopFollowing={stopFollowing}
        />
        {eraserPreview && <div className="stroke-eraser-preview" style={{ left: eraserPreview.x, top: eraserPreview.y, width: eraserPreview.radius * 2, height: eraserPreview.radius * 2 }} />}
        <RichTextLayer
          ref={richTextLayerRef}
          api={api}
          disabled={status !== 'Live'}
          onEditStart={beginRichTextOperation}
          onEditEnd={endRichTextOperation}
          onDraft={recordRichTextDraft}
        />
        <SelectionToolbar
          api={api}
          selection={selectionSnapshot}
          disabled={status !== 'Live'}
          onNotice={notify}
          objectsSnapEnabled={objectsSnapModeEnabled}
          gridEnabled={gridModeEnabled}
          onObjectsSnapPreference={rememberObjectsSnap}
          onGridPreference={rememberGridMode}
          onSelectionRefresh={refreshSelectionUi}
          onManipulationCommit={captureCurrentScene}
          onReplaceImage={replaceImageFile}
        />
        <NavigationOverlay ref={navigationRef} api={api} onSelectionRefresh={refreshCanvasSelectionOverlays} />
      </div>
      {recoveryNotice && <div className="network-banner"><span>{recoveryNotice}</span>{navigator.onLine && (status === 'Error' || status === 'Reconnecting') && <button type="button" onClick={retryConnectionNow}>Retry now</button>}</div>}
      {status === 'Live' && (syncHealth.key === 'retrying-save' || syncHealth.key === 'confirming-save') && <div className={`save-health-banner save-health-banner--${syncHealth.tone}`}><span>{syncHealth.detail}</span>{syncHealth.key === 'retrying-save' && <button type="button" onClick={retrySaveNow}>Retry now</button>}</div>}
      {notice && <div className="canvas-notice" role="status">{notice}</div>}
    </main>
  </div>
}
