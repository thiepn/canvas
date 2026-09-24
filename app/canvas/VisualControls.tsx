import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon.tsx'
import type { ThemePreference } from '../storage/preferences.ts'
import {
  ACCENT_PRESETS,
  PAPER_PRESETS,
  type CanvasAccent,
  type CanvasGridPattern,
  type CanvasMotion,
  type CanvasPaper,
  type CanvasVisualProfile,
} from './visual-system.ts'

type Props = {
  theme: ThemePreference
  profile: CanvasVisualProfile
  disabled?: boolean
  onTheme: (theme: ThemePreference) => void
  onProfile: (profile: CanvasVisualProfile) => void
  onDelight: () => void
}

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const GRID_PATTERNS: Array<{ value: CanvasGridPattern; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Lines' },
  { value: 'squares', label: 'Squares' },
]

const MOTIONS: Array<{ value: CanvasMotion; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
]

export function VisualControls({ theme, profile, disabled = false, onTheme, onProfile, onDelight }: Props) {
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

  const patch = <K extends keyof CanvasVisualProfile>(key: K, value: CanvasVisualProfile[K]) => {
    onProfile({ ...profile, [key]: value })
  }

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`icon-button visual-controls-button${open ? ' is-active' : ''}`}
      aria-label="Canvas visuals"
      aria-expanded={open}
      title="Canvas visuals"
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
    ><Icon name="palette" /></button>

    {open && <div ref={panelRef} className="visual-controls-popover" aria-label="Canvas visuals menu">
      <div className="visual-section">
        <div className="visual-section-heading">APPEARANCE</div>
        <div className="visual-segmented" role="group" aria-label="Theme">
          {THEMES.map(option => <button
            key={option.value}
            type="button"
            className={theme === option.value ? 'is-active' : ''}
            aria-pressed={theme === option.value}
            onClick={() => onTheme(option.value)}
          >{option.label}</button>)}
        </div>
      </div>

      <div className="visual-section">
        <div className="visual-section-heading">ACCENT</div>
        <div className="visual-swatches" role="group" aria-label="Accent color">
          {(Object.entries(ACCENT_PRESETS) as Array<[CanvasAccent, (typeof ACCENT_PRESETS)[CanvasAccent]]>).map(([value, preset]) => <button
            key={value}
            type="button"
            className={`visual-accent-swatch${profile.accent === value ? ' is-active' : ''}`}
            aria-label={`${preset.label} accent`}
            aria-pressed={profile.accent === value}
            style={{ '--visual-swatch': preset.light } as React.CSSProperties}
            onClick={() => patch('accent', value)}
          />)}
        </div>
      </div>

      <div className="visual-section">
        <div className="visual-section-heading">PAPER</div>
        <div className="visual-paper-grid" role="group" aria-label="Canvas paper">
          {(Object.entries(PAPER_PRESETS) as Array<[CanvasPaper, (typeof PAPER_PRESETS)[CanvasPaper]]>).map(([value, preset]) => <button
            key={value}
            type="button"
            className={profile.paper === value ? 'is-active' : ''}
            aria-pressed={profile.paper === value}
            onClick={() => patch('paper', value)}
          ><span className={`visual-paper-preview visual-paper-preview--${value}`} />{preset.label}</button>)}
        </div>
      </div>

      <div className="visual-section">
        <div className="visual-section-heading">BACKGROUND</div>
        <div className="visual-segmented visual-grid-patterns" role="group" aria-label="Background grid">
          {GRID_PATTERNS.map(option => <button
            key={option.value}
            type="button"
            className={profile.gridPattern === option.value ? 'is-active' : ''}
            aria-pressed={profile.gridPattern === option.value}
            onClick={() => patch('gridPattern', option.value)}
          >{option.label}</button>)}
        </div>
        <label className="visual-range-control">Spacing
          <input aria-label="Grid spacing" type="range" min="12" max="72" step="2" value={profile.gridSize} disabled={profile.gridPattern === 'none'} onChange={event => patch('gridSize', Number(event.target.value))} />
          <output>{Math.round(profile.gridSize)}</output>
        </label>
        <label className="visual-range-control">Strength
          <input aria-label="Grid strength" type="range" min="4" max="36" step="2" value={profile.gridOpacity} disabled={profile.gridPattern === 'none'} onChange={event => patch('gridOpacity', Number(event.target.value))} />
          <output>{Math.round(profile.gridOpacity)}</output>
        </label>
        <label className="visual-toggle">
          <input type="checkbox" checked={profile.ambientGlow} onChange={event => patch('ambientGlow', event.target.checked)} />
          <span>Ambient edge glow</span>
        </label>
      </div>

      <div className="visual-section">
        <div className="visual-section-heading">DELIGHT</div>
        <div className="visual-segmented" role="group" aria-label="Motion">
          {MOTIONS.map(option => <button
            key={option.value}
            type="button"
            className={profile.motion === option.value ? 'is-active' : ''}
            aria-pressed={profile.motion === option.value}
            onClick={() => patch('motion', option.value)}
          >{option.label}</button>)}
        </div>
        <div className="visual-toggle-grid">
          <label className="visual-toggle"><input type="checkbox" checked={profile.sounds} onChange={event => patch('sounds', event.target.checked)} /><span>UI sounds</span></label>
          <label className="visual-toggle"><input type="checkbox" checked={profile.haptics} onChange={event => patch('haptics', event.target.checked)} /><span>Haptics</span></label>
        </div>
        <button type="button" className="visual-spark-button" onClick={onDelight}><Icon name="sparkle" />Tiny sparkle</button>
      </div>
    </div>}
  </>
}
