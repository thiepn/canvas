import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { Icon } from '../components/Icon.tsx'
import { browserStorage, cleanName, loadIdentity, saveIdentity, type Identity } from '../presence/identity.ts'
import { loadTheme, writePreference, type ThemePreference } from '../storage/preferences.ts'
import type { LiveConfig } from '../config/public-config.ts'
import { isNewerVersion, shouldKeepPending, type VersionStamp } from './sync-version.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]
type ConnectionState = 'Connecting' | 'Synchronizing' | 'Live' | 'Reconnecting' | 'Offline' | 'Error'
type PresencePerson = { deviceId: string; displayName: string; color: string }
type SyncRow = { id: string; version: number; version_nonce: number; is_deleted: boolean; element: unknown }
type CursorPayload = {
  deviceId: string
  displayName: string
  pointer: { x: number; y: number; tool: 'pointer' | 'laser' }
  button: 'up' | 'down'
  selectedElementIds: Record<string, boolean>
}

const ALLOWED_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'frame'])
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

function normalizeRow(value: unknown): SyncRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : ''
  const version = Number(row.version)
  const versionNonce = Number(row.version_nonce)
  if (!id || !Number.isInteger(version) || !Number.isInteger(versionNonce) || typeof row.is_deleted !== 'boolean') return null
  return { id, version, version_nonce: versionNonce, is_deleted: row.is_deleted, element: row.element }
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
  return <header className="canvas-header live-canvas-header">
    <h1>Canvas<span className="brand-period" aria-hidden="true">.</span></h1>
    <div role="status" aria-live="polite" className={`connection connection--${status.toLowerCase()}`}><span aria-hidden="true" />{status}</div>
    <div className="header-spacer" />
    <div className="people-peek" aria-label={status === 'Live' ? `${people.length + 1} people connected` : 'No active connection'}>{status === 'Live' && people.slice(0, 3).map(person => <span key={person.deviceId} title={person.displayName} className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />)}</div>
    <button type="button" className="icon-button fit-button" aria-label="Fit content" title="Fit all content" disabled={!api} onClick={fit}><Icon name="fit" /></button>
    <button ref={triggerRef} type="button" className="identity-trigger" aria-label="Canvas menu and presence" aria-expanded={menu} aria-controls={menu ? 'live-canvas-menu' : undefined} onClick={() => setMenu(!menu)}><span className="identity-initial" style={{ borderColor: safeColor(identity.color) }}>{identity.displayName.slice(0, 1).toUpperCase()}</span><span className="identity-name">{identity.displayName}</span><Icon name="more" /></button>
    {menu && <div ref={menuRef} id="live-canvas-menu" className="canvas-menu" aria-label="Canvas settings">
      <div className="menu-heading">ON THIS CANVAS</div>
      <div className="people-list"><div><span className="presence-dot" style={{ backgroundColor: safeColor(identity.color) }} />{identity.displayName}<small>You</small></div>{status === 'Live' && people.map(person => <div key={person.deviceId}><span className="presence-dot" style={{ backgroundColor: safeColor(person.color) }} />{person.displayName || 'Guest'}</div>)}</div>
      <form onSubmit={submit}><label htmlFor="live-display-name">Display name</label><div className="name-input"><input id="live-display-name" autoComplete="off" maxLength={32} value={name} onChange={event => setName(event.target.value)} /><button type="submit">Save</button></div></form>
      <label htmlFor="live-theme">Appearance</label><select id="live-theme" value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <div className="menu-heading menu-tools-heading">CANVAS CONTROLS</div>
      <button type="button" className="menu-action" disabled={!api} onClick={() => downloadBackup(api)}><Icon name="download" />Export JSON backup</button>
      <button type="button" className="menu-action" disabled={!api} onClick={() => { fit(); setMenu(false) }}><Icon name="fit" />Fit all content</button>
      <p className="privacy-note">One shared canvas. Anyone with the link can read and change everything. Names are not verified identities.</p>
      <p className="shortcut-note">V Select · R Rectangle · O Ellipse · A Arrow · D Draw · T Text<br />E Eraser · Space Pan · Ctrl/⌘ Z Undo</p>
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
  const [people, setPeople] = useState<PresencePerson[]>([])
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const shadowRef = useRef(new Map<string, VersionStamp>())
  const pendingRef = useRef(new Map<string, SceneElement>())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRemote = useRef(false)
  const collaboratorsRef = useRef(new Map<SocketId, Collaborator>())
  const cursorAt = useRef(0)

  const supabase = useMemo(() => createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), [config.supabaseKey, config.supabaseUrl])

  const resolvedTheme = theme === 'system' ? systemDark ? 'dark' : 'light' : theme

  const notify = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])

  useEffect(() => { identityRef.current = identity }, [identity])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { apiRef.current = api }, [api])
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    if (flushTimer.current) clearTimeout(flushTimer.current)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme }, [resolvedTheme])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const offline = () => setStatus('Offline')
    const online = () => setStatus(current => current === 'Live' ? current : 'Reconnecting')
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [])

  const applyRows = useCallback((values: unknown[], replace = false) => {
    const editor = apiRef.current
    if (!editor) return
    const rows = values.map(normalizeRow).filter((row): row is SyncRow => row !== null)
    const currentElements = replace ? new Map<string, SceneElement>() : new Map(editor.getSceneElementsIncludingDeleted().map(element => [element.id, element]))
    if (replace) shadowRef.current.clear()
    let changed = replace
    for (const row of rows) {
      const element = elementFromRow(row)
      if (!element) continue
      const nextStamp = { version: row.version, versionNonce: row.version_nonce, isDeleted: row.is_deleted }
      if (!replace && !isNewerVersion(nextStamp, shadowRef.current.get(row.id))) continue
      const pending = pendingRef.current.get(row.id)
      if (!replace && pending && shouldKeepPending(stampOf(pending), nextStamp)) {
        shadowRef.current.set(row.id, nextStamp)
        continue
      }
      if (pending) pendingRef.current.delete(row.id)
      shadowRef.current.set(row.id, nextStamp)
      currentElements.set(row.id, element)
      changed = true
    }
    if (!changed) return
    applyingRemote.current = true
    editor.updateScene({ elements: Array.from(currentElements.values()), captureUpdate: CaptureUpdateAction.NEVER })
    queueMicrotask(() => { applyingRemote.current = false })
  }, [])

  const loadAuthoritative = useCallback(async () => {
    const { data, error } = await supabase.from(config.tableName).select('id,version,version_nonce,is_deleted,element').order('updated_at', { ascending: true })
    if (error) throw error
    applyRows(data ?? [], pendingRef.current.size === 0)
  }, [applyRows, config.tableName, supabase])

  const flushPending = useCallback(async () => {
    if (statusRef.current !== 'Live' || !navigator.onLine || pendingRef.current.size === 0) return
    const elements = Array.from(pendingRef.current.values())
    pendingRef.current.clear()
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
        const queued = pendingRef.current.get(element.id)
        if (!queued || isNewerVersion(stampOf(element), stampOf(queued))) pendingRef.current.set(element.id, element)
      }
      if (!navigator.onLine) setStatus('Offline')
      notify(`Canvas could not save: ${error.message}`)
      if (navigator.onLine) {
        try {
          await loadAuthoritative()
        } catch {
          // Keep the local queue intact. The normal retry path below will try again.
        }
      }
      if (navigator.onLine && pendingRef.current.size && !flushTimer.current) {
        flushTimer.current = setTimeout(() => { flushTimer.current = null; void flushPending() }, 1200)
      }
      return
    }
    const { data, error: readError } = await supabase.from(config.tableName).select('id,version,version_nonce,is_deleted,element').in('id', ids)
    if (readError) {
      notify(`Canvas saved, but could not confirm the latest state: ${readError.message}`)
      return
    }
    applyRows(data ?? [])
  }, [applyRows, config.tableName, loadAuthoritative, notify, supabase])

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      void flushPending()
    }, 120)
  }, [flushPending])

  useEffect(() => {
    if (status === 'Live' && pendingRef.current.size) scheduleFlush()
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
    const channel = supabase.channel(`canvas:${config.tableName}:v1`, { config: { presence: { key: identity.deviceId }, broadcast: { self: false } } })
    channelRef.current = channel
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: config.tableName }, payload => {
        if (payload.new && Object.keys(payload.new).length) applyRows([payload.new])
      })
      .on('presence', { event: 'sync' }, () => syncPresence(channel))
      .on('broadcast', { event: 'cursor' }, message => {
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
        if (disposed) return
        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus('Synchronizing')
          void channel.track({ deviceId: identityRef.current.deviceId, displayName: identityRef.current.displayName, color: identityRef.current.color, onlineAt: new Date().toISOString() })
            .then(() => loadAuthoritative())
            .then(() => {
              if (disposed) return
              setStatus(navigator.onLine ? 'Live' : 'Offline')
              if (navigator.onLine && pendingRef.current.size) scheduleFlush()
            })
            .catch(error => { if (!disposed) { setStatus('Error'); notify(`Canvas could not synchronize: ${error instanceof Error ? error.message : String(error)}`) } })
        } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT' || subscriptionStatus === 'CLOSED') {
          setStatus(navigator.onLine ? 'Reconnecting' : 'Offline')
        }
      })
    return () => {
      disposed = true
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [api, applyRows, config.tableName, identity.deviceId, loadAuthoritative, notify, scheduleFlush, supabase, syncPresence])

  useEffect(() => {
    const channel = channelRef.current
    if (!channel || (status !== 'Live' && status !== 'Synchronizing')) return
    void channel.track({ deviceId: identity.deviceId, displayName: identity.displayName, color: identity.color, onlineAt: new Date().toISOString() })
  }, [identity, status])

  const onChange = useCallback((elements: readonly SceneElement[]) => {
    if (applyingRemote.current || statusRef.current !== 'Live') return
    const allowed = elements.filter(isAllowedElement)
    if (allowed.length !== elements.length) {
      notify('Images, embeds, and file-backed objects are disabled on this canvas.')
      applyingRemote.current = true
      apiRef.current?.updateScene({ elements: allowed, captureUpdate: CaptureUpdateAction.NEVER })
      queueMicrotask(() => { applyingRemote.current = false })
    }
    for (const element of allowed) {
      const nextStamp = stampOf(element)
      if (!isNewerVersion(nextStamp, shadowRef.current.get(element.id))) continue
      const queued = pendingRef.current.get(element.id)
      if (!queued || isNewerVersion(nextStamp, stampOf(queued))) pendingRef.current.set(element.id, element)
    }
    if (pendingRef.current.size) scheduleFlush()
  }, [notify, scheduleFlush])

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
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
          name="Canvas"
          langCode="en"
        />
      </div>
      {status !== 'Live' && <div className="network-banner" role="status">{status === 'Error' ? 'Canvas could not synchronize. Check the connection and reload.' : `${status} — editing is paused until the shared canvas is synchronized.`}</div>}
      {notice && <div className="canvas-notice" role="status">{notice}</div>}
    </main>
  </div>
}
