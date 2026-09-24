import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon.tsx'

export type CanvasExportFormat = 'json' | 'png' | 'svg' | 'pdf'

export function MediaControls({
  disabled,
  busy,
  onAddImage,
  onImport,
  onExport,
}: {
  disabled: boolean
  busy: boolean
  onAddImage: (file: File) => void | Promise<void>
  onImport: (file: File) => void | Promise<void>
  onExport: (format: CanvasExportFormat) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const pick = async (file: File | undefined, handler: (file: File) => void | Promise<void>) => {
    if (!file) return
    setOpen(false)
    await handler(file)
  }

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`icon-button media-controls-button${open ? ' is-active' : ''}`}
      aria-label="Images and transfer"
      aria-expanded={open}
      title="Images, import and export"
      disabled={disabled || busy}
      onClick={() => setOpen(value => !value)}
    ><Icon name="image" /></button>

    <input
      ref={imageInputRef}
      className="visually-hidden-file-input"
      type="file"
      tabIndex={-1}
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        void pick(file, onAddImage)
      }}
    />
    <input
      ref={importInputRef}
      className="visually-hidden-file-input"
      type="file"
      tabIndex={-1}
      accept=".json,.excalidraw,application/json,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
      onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        void pick(file, onImport)
      }}
    />

    {open && <div ref={panelRef} className="media-controls-popover" aria-label="Images and transfer menu">
      <div className="menu-heading">ADD</div>
      <button type="button" disabled={disabled || busy} onClick={() => imageInputRef.current?.click()}><Icon name="image" />Image</button>
      <button type="button" disabled={disabled || busy} onClick={() => importInputRef.current?.click()}><Icon name="upload" />Import file</button>
      <div className="menu-heading media-export-heading">EXPORT</div>
      <div className="media-export-grid">
        {(['json', 'png', 'svg', 'pdf'] as CanvasExportFormat[]).map(format => <button
          key={format}
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            void onExport(format)
          }}
        >{format.toUpperCase()}</button>)}
      </div>
      <p>Images stay on the canvas. JSON exports include referenced image data for portable backups.</p>
    </div>}
  </>
}
