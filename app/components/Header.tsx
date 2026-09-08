import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useValue, type Editor } from 'tldraw'
import { Icon } from './Icon.tsx'
import type { Identity } from '../presence/identity.ts'
import type { ThemePreference } from '../storage/preferences.ts'
export type ConnectionState = 'Connecting' | 'Live' | 'Reconnecting' | 'Offline' | 'Error'
export interface HeaderProps {
  editor: Editor | null; identity: Identity; status: ConnectionState; theme: ThemePreference
  rename: (value: string) => void; changeTheme: (theme: ThemePreference) => void; exportState: () => Promise<void>
}
export function Header({ editor, identity, status, theme, rename, changeTheme, exportState }: HeaderProps) {
  const [menu, setMenu] = useState(false), [name, setName] = useState(identity.displayName), [exporting, setExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null)
  const peopleJSON = useValue('canvas.people', () => JSON.stringify(editor?.getCollaborators().map(person => ({ id: person.userId, name: person.userName, color: person.color })) ?? []), [editor])
  const people = (JSON.parse(peopleJSON) as Array<{ id: string; name: string; color: string }>).filter((person, index, all) => all.findIndex(other => other.id === person.id) === index)
  useEffect(() => {
    if (!menu) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); triggerRef.current?.focus(); event.stopPropagation() } }
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside) }
  }, [menu])
  function home() { if (editor) { editor.setCamera({ x: 0, y: 0, z: 1 }); editor.centerOnPoint({ x: 0, y: 0 }); editor.focus() } }
  function submit(event: FormEvent) { event.preventDefault(); rename(name); setMenu(false); triggerRef.current?.focus() }
  return <header className="canvas-header">
    <h1>Canvas<span className="brand-period" aria-hidden="true">.</span></h1>
    <div role="status" aria-live="polite" className={`connection connection--${status.toLowerCase()}`} title={status === 'Live' ? 'Connected to the shared canvas. Live is not an acknowledgement that every last edit has been saved.' : 'Editing pauses while disconnected. Keep this tab open to reconnect.'}><span aria-hidden="true" />{status}</div>
    <div className="header-spacer" />
    <div className="people-peek" aria-label={status === 'Live' ? `${people.length + 1} people connected` : 'No active connection'}>{status === 'Live' && people.slice(0, 3).map(person => <span key={person.id} title={person.name} className="presence-dot" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(person.color) ? person.color : '#666666' }} />)}</div>
    <button type="button" className="icon-button" aria-label="Home" title="Return to origin" disabled={!editor} onClick={home}><Icon name="home" /></button>
    <button type="button" className="icon-button fit-button" aria-label="Fit content" title="Fit all content" disabled={!editor} onClick={() => editor?.zoomToFit()}><Icon name="fit" /></button>
    <button ref={triggerRef} type="button" className="identity-trigger" aria-label="Canvas menu and presence" aria-expanded={menu} aria-controls={menu ? 'canvas-menu' : undefined} onClick={() => setMenu(!menu)}><span className="identity-initial" style={{ borderColor: identity.color }}>{identity.displayName.slice(0, 1).toUpperCase()}</span><span className="identity-name">{identity.displayName}</span><Icon name="more" /></button>
    {menu && <div ref={menuRef} id="canvas-menu" className="canvas-menu" aria-label="Canvas settings">
      <div className="menu-heading">ON THIS CANVAS</div>
      <div className="people-list"><div><span className="presence-dot" style={{ backgroundColor: identity.color }} />{identity.displayName}<small>You</small></div>{status === 'Live' && people.map(person => <div key={person.id}><span className="presence-dot" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(person.color) ? person.color : '#666666' }} />{person.name || 'Guest'}</div>)}</div>
      <form onSubmit={submit}><label htmlFor="display-name">Display name</label><div className="name-input"><input id="display-name" autoComplete="off" maxLength={32} value={name} onChange={event => setName(event.target.value)} /><button type="submit">Save</button></div></form>
      <label htmlFor="theme">Appearance</label><select id="theme" value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <div className="menu-heading menu-tools-heading">CANVAS CONTROLS</div>
      <div className="menu-control-row" role="group" aria-label="Edit history">
        <button type="button" disabled={!editor || status !== 'Live'} onClick={() => editor?.undo()}><Icon name="undo" />Undo</button>
        <button type="button" disabled={!editor || status !== 'Live'} onClick={() => editor?.redo()}><Icon name="redo" />Redo</button>
      </div>
      <div className="menu-control-row" role="group" aria-label="Zoom controls">
        <button type="button" disabled={!editor} onClick={() => editor?.zoomOut()}><Icon name="minus" />Zoom out</button>
        <button type="button" disabled={!editor} onClick={() => editor?.zoomIn()}><Icon name="plus" />Zoom in</button>
      </div>
      <button type="button" className="menu-action" disabled={exporting} onClick={async () => { setExporting(true); try { await exportState() } finally { setExporting(false) } }}><Icon name="download" />{exporting ? 'Exporting…' : 'Export JSON backup'}</button>
      <button type="button" className="menu-action" disabled={!editor} onClick={() => { editor?.zoomToFit(); setMenu(false) }}><Icon name="fit" />Fit all content</button>
      <p className="privacy-note">One shared canvas. Anyone with the link can read and change everything. Names are not verified identities.</p>
      <p className="shortcut-note">V Select · D Draw · T Text · F Frame<br />Space Pan · Ctrl/⌘ Z Undo</p>
    </div>}
  </header>
}
