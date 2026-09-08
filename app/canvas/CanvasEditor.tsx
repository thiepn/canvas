import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useSync } from '@tldraw/sync'
import { atom, createUserId, getDefaultUserPresence, Tldraw, type Editor, type TLUser } from 'tldraw'
import 'tldraw/tldraw.css'
import { Header, type ConnectionState } from '../components/Header.tsx'
import { browserStorage, cleanName, loadIdentity, saveIdentity } from '../presence/identity.ts'
import { loadTheme, readPreference, writePreference, type ThemePreference } from '../storage/preferences.ts'
import { exportCanvas } from '../storage/export.ts'
import { installClipboardGuards } from './clipboard-policy.ts'
import { installContentPolicy, NO_ASSETS } from './content.ts'
import { LIMITS } from '../../shared/limits.ts'
import { UI_COMPONENTS, UI_OVERRIDES } from './editor-ui.tsx'
import type { PublicConfig } from '../config/public-config.ts'

const ASSET_URLS = getAssetUrlsByImport()
const EDITOR_OPTIONS = { maxPages: 1, maxShapesPerPage: LIMITS.shapes }
const NO_MIMES: readonly string[] = []
export default function CanvasEditor({ config }: { config: PublicConfig }) {
  const storage = useMemo(browserStorage, [])
  const [identity, setIdentity] = useState(() => loadIdentity(storage))
  const [theme, setTheme] = useState(() => loadTheme(storage))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine)
  const [notice, setNotice] = useState('')
  const [connectionSlow, setConnectionSlow] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(() => readPreference(storage, 'canvas.hint.dismissed') === 'yes')
  const noticeAt = useRef(0), noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const initialIdentity = useRef(identity)
  const presenceIdentity = useMemo(() => atom('canvas.presence-identity', initialIdentity.current), [])
  // A non-null currentUser enables persistent attribution in tldraw 5.4. Canvas has NO accounts.
  const users = useMemo(() => ({ currentUser: atom<TLUser | null>('canvas.anonymous-user', null) }), [])
  const getUserPresence = useCallback<NonNullable<Parameters<typeof useSync>[0]['getUserPresence']>>((store, user) => {
    const base = getDefaultUserPresence(store, user)
    if (!base) return null
    const local = presenceIdentity.get()
    return { ...base, userId: createUserId(local.deviceId), userName: local.displayName, color: local.color, chatMessage: '' }
  }, [presenceIdentity])
  const sync = useSync({ uri: config.websocketUrl, assets: NO_ASSETS, users, getUserPresence })
  const online = browserOnline && sync.status === 'synced-remote' && sync.connectionStatus === 'online'
  const status: ConnectionState = !browserOnline ? 'Offline' : sync.status === 'error' ? 'Error' : online ? 'Live' : sync.status === 'synced-remote' ? 'Reconnecting' : 'Connecting'
  useEffect(() => {
    if (sync.status !== 'loading') return
    const timer = setTimeout(() => setConnectionSlow(true), 10000)
    return () => clearTimeout(timer)
  }, [sync.status])
  const notify = useCallback((message: string) => {
    if (Date.now() - noticeAt.current < 1500) return
    noticeAt.current = Date.now(); setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!rootRef.current) return
    return installClipboardGuards(rootRef.current, notify)
  }, [notify])
  useEffect(() => {
    presenceIdentity.set(identity)
    editor?.user.updateUserPreferences({ id: identity.deviceId, name: identity.displayName, color: identity.color })
  }, [identity, editor, presenceIdentity])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme
      editor?.user.updateUserPreferences({ colorScheme: theme })
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, editor])
  useEffect(() => { editor?.updateInstanceState({ isReadonly: !online }) }, [editor, online])
  useEffect(() => {
    // No promise of long-term offline editing. Pending sync is retained only while this tab lives.
    if (online || !editor) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [online, editor])
  const onMount = useCallback((instance: Editor) => {
    setEditor(instance)
    instance.setCamera({ x: 0, y: 0, z: 1 }); instance.centerOnPoint({ x: 0, y: 0 })
    installContentPolicy(instance, notify)
    let disposeTestBridge: (() => void) | undefined
    let disposed = false
    if (import.meta.env.MODE === 'test') {
      void import('./test-bridge.ts').then(({ installTestBridge }) => { if (!disposed) disposeTestBridge = installTestBridge(instance) })
    }
    return () => { disposed = true; disposeTestBridge?.() }
  }, [notify])
  const rename = (value: string) => {
    const next = { ...identity, displayName: cleanName(value) }; setIdentity(next)
    if (!saveIdentity(storage, next)) notify('Browser storage is unavailable. This name lasts until the tab closes.')
  }
  const changeTheme = (next: ThemePreference) => { setTheme(next); writePreference(storage, 'canvas.theme.v1', next) }
  return <div className="canvas-app" ref={rootRef}>
    <Header editor={editor} identity={identity} status={status} theme={theme} rename={rename} changeTheme={changeTheme} exportState={() => exportCanvas(config.apiUrl, editor, online, notify)} />
    <main className="canvas-workspace" aria-label="Shared infinite canvas">
      {sync.status === 'error' ? <div className="app-message" role="alert"><h2>Canvas could not connect</h2><p>{sync.error.message}</p><p>Check the backend URL, allowed origin, and deployment. No local document has replaced the shared world.</p><button type="button" onClick={() => location.reload()}>Try again</button></div> : <Tldraw store={sync} assets={NO_ASSETS} assetUrls={ASSET_URLS} licenseKey={config.licenseKey} components={UI_COMPONENTS} overrides={UI_OVERRIDES} acceptedImageMimeTypes={NO_MIMES} acceptedVideoMimeTypes={NO_MIMES} maxAssetSize={0} locale="en" options={EDITOR_OPTIONS} onMount={onMount} />}
      {connectionSlow && sync.status === 'loading' && <div className="network-banner" role="status">Still connecting. Check your internet connection and that the Canvas backend is deployed and permits this site’s origin. Connection attempts continue automatically.</div>}
      {!online && sync.status === 'synced-remote' && <div className="network-banner" role="status">{browserOnline ? 'Reconnecting' : 'Offline'} — editing is paused. Keep this tab open; pending changes will reconnect automatically. You can export a local recovery copy.</div>}
      {online && !hintDismissed && <div className="empty-hint"><span>Draw, type, or make shapes anywhere.</span><button type="button" aria-label="Dismiss hint" onClick={() => { setHintDismissed(true); writePreference(storage, 'canvas.hint.dismissed', 'yes') }}>×</button></div>}
      {notice && <div className="canvas-notice" role="status">{notice}</div>}
    </main>
  </div>
}
