import { GeoShapeGeoStyle, useEditor, useTools, useValue } from 'tldraw'
import type { KeyboardEvent } from 'react'
import { TOOL_IDS } from '../../shared/limits.ts'
import { Icon } from '../components/Icon.tsx'

const labels: Record<string, string> = { select: 'Select', hand: 'Pan', draw: 'Draw', highlight: 'Highlighter', text: 'Text', rectangle: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', line: 'Line', arrow: 'Arrow', frame: 'Frame', eraser: 'Eraser' }
export function CanvasToolbar() {
  const editor = useEditor(), tools = useTools()
  const active = useValue('canvas.tool', () => editor.getCurrentToolId() === 'geo' ? editor.getStyleForNextShape(GeoShapeGeoStyle) : editor.getCurrentToolId(), [editor])
  const readonly = useValue('canvas.readonly', () => editor.getInstanceState().isReadonly, [editor])
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus()
  }
  return <div className="canvas-toolbar" role="toolbar" aria-label="Drawing tools" onKeyDown={handleKey}>
    {TOOL_IDS.map(id => <button key={id} type="button" aria-label={labels[id]} aria-pressed={active === id} title={`${labels[id]}${tools[id]?.kbd ? ` (${tools[id].kbd})` : ''}`} disabled={readonly && !['select', 'hand'].includes(id)} onPointerDown={event => event.stopPropagation()} onClick={() => tools[id]?.onSelect('toolbar')}><Icon name={id} /><span>{labels[id]}</span></button>)}
  </div>
}
