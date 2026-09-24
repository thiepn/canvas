import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon.tsx'
import type { DrawingMode } from './drawing-tools.ts'
import { CANVAS_HIGHLIGHT_COLORS, CANVAS_STROKE_COLORS } from './visual-system.ts'

export type DrawingControlSettings = {
  penColor: string
  penWidth: number
  penOpacity: number
  smoothing: number
  pressure: boolean
  highlighterColor: string
  highlighterWidth: number
  eraserRadius: number
  holdToClean: boolean
  stylusMode: boolean
}

type Props = {
  disabled: boolean
  mode: DrawingMode | null
  settings: DrawingControlSettings
  onMode: (mode: DrawingMode) => void
  onSetting: (key: keyof DrawingControlSettings, value: DrawingControlSettings[keyof DrawingControlSettings]) => void
}

const PEN_PRESETS = [1, 2, 4, 6, 10] as const
const HIGHLIGHTER_PRESETS = [8, 12, 18, 24] as const

export function DrawingControls({ disabled, mode, settings, onMode, onSetting }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const pointerdown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', pointerdown)
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('pointerdown', pointerdown)
      document.removeEventListener('keydown', keydown, true)
    }
  }, [open])

  const selectMode = (next: DrawingMode) => {
    onMode(next)
    if (next === 'partial-eraser' || next === 'object-eraser') setOpen(false)
  }

  const penLike = mode === 'pen' || mode === 'highlighter'
  const color = mode === 'highlighter' ? settings.highlighterColor : settings.penColor
  const width = mode === 'highlighter' ? settings.highlighterWidth : settings.penWidth
  const presets = mode === 'highlighter' ? HIGHLIGHTER_PRESETS : PEN_PRESETS

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`icon-button drawing-menu-button${open || mode ? ' is-active' : ''}`}
      aria-label="Drawing tools"
      aria-expanded={open}
      title="Drawing tools"
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
    >
      <Icon name={mode === 'highlighter' ? 'highlight' : mode?.includes('eraser') ? 'eraser' : 'draw'} />
    </button>
    {open && <div ref={panelRef} className="drawing-controls-popover" aria-label="Drawing tools menu">
      <div className="drawing-controls-heading">DRAWING</div>
      <div className="drawing-mode-grid">
        <button type="button" className={mode === 'pen' ? 'is-active' : ''} onClick={() => selectMode('pen')}><Icon name="draw" />Pen</button>
        <button type="button" className={mode === 'highlighter' ? 'is-active' : ''} onClick={() => selectMode('highlighter')}><Icon name="highlight" />Highlight</button>
        <button type="button" className={mode === 'partial-eraser' ? 'is-active' : ''} onClick={() => selectMode('partial-eraser')}><Icon name="eraser" />Stroke erase</button>
        <button type="button" className={mode === 'object-eraser' ? 'is-active' : ''} onClick={() => selectMode('object-eraser')}><Icon name="eraser" />Object erase</button>
      </div>

      {penLike && <>
        <div className="drawing-control-row">
          <label>{mode === 'highlighter' ? 'Highlight color' : 'Pen color'}
            <input type="color" value={color} onChange={event => onSetting(mode === 'highlighter' ? 'highlighterColor' : 'penColor', event.target.value)} />
          </label>
          <label>Width
            <input
              aria-label="Drawing width"
              type="number"
              min="0.5"
              max="32"
              step="0.5"
              value={width}
              onChange={event => onSetting(mode === 'highlighter' ? 'highlighterWidth' : 'penWidth', Number(event.target.value))}
            />
          </label>
        </div>
        <div className="drawing-color-swatches" aria-label={mode === 'highlighter' ? 'Highlighter color presets' : 'Pen color presets'}>
          {(mode === 'highlighter' ? CANVAS_HIGHLIGHT_COLORS : CANVAS_STROKE_COLORS).slice(0, 10).map(value => <button
            key={value}
            type="button"
            className={color.toLowerCase() === value.toLowerCase() ? 'is-active' : ''}
            aria-label={`Color ${value}`}
            style={{ '--drawing-swatch': value } as CSSProperties}
            onClick={() => onSetting(mode === 'highlighter' ? 'highlighterColor' : 'penColor', value)}
          />)}
        </div>
        <div className="drawing-width-presets" aria-label="Width presets">
          {presets.map(value => <button key={value} type="button" className={width === value ? 'is-active' : ''} onClick={() => onSetting(mode === 'highlighter' ? 'highlighterWidth' : 'penWidth', value)}>{value}</button>)}
        </div>
        <label className="drawing-range-control">Smoothing
          <input type="range" min="0" max="100" step="5" value={settings.smoothing} onChange={event => onSetting('smoothing', Number(event.target.value))} />
          <output>{Math.round(settings.smoothing)}</output>
        </label>
        {mode === 'pen' && <label className="drawing-range-control">Opacity
          <input aria-label="Pen opacity" type="range" min="5" max="100" step="5" value={settings.penOpacity} onChange={event => onSetting('penOpacity', Number(event.target.value))} />
          <output>{Math.round(settings.penOpacity)}</output>
        </label>}
      </>}

      {mode === 'pen' && <div className="drawing-toggle-grid">
        <button type="button" className={settings.pressure ? 'is-active' : ''} aria-pressed={settings.pressure} onClick={() => onSetting('pressure', !settings.pressure)}>Pressure</button>
        <button type="button" className={settings.holdToClean ? 'is-active' : ''} aria-pressed={settings.holdToClean} onClick={() => onSetting('holdToClean', !settings.holdToClean)}>Hold to clean</button>
      </div>}

      {mode === 'partial-eraser' && <label className="drawing-range-control">Eraser size
        <input type="range" min="4" max="48" step="2" value={settings.eraserRadius} onChange={event => onSetting('eraserRadius', Number(event.target.value))} />
        <output>{Math.round(settings.eraserRadius * 2)}</output>
      </label>}

      <button type="button" className={`drawing-stylus-toggle${settings.stylusMode ? ' is-active' : ''}`} aria-pressed={settings.stylusMode} onClick={() => onSetting('stylusMode', !settings.stylusMode)}>
        Stylus mode
        <small>{settings.stylusMode ? 'Pen draws · finger pans' : 'Touch can draw'}</small>
      </button>
      <p className="drawing-controls-note">Two fingers pan and pinch. Hold briefly after a pen stroke to straighten a line or clean a rough rectangle/circle.</p>
    </div>}
  </>
}
