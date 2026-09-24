import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useEffect, useMemo, useState } from 'react'
import {
  alignSelection,
  commonBounds,
  copyVisualStyle,
  distributeSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  pasteVisualStyle,
  reorderSelection,
  resetRotation,
  resizeSelection,
  rotateSelection,
  selectFrameContents,
  selectSame,
  setSelectionPosition,
  toggleLockSelection,
  ungroupSelection,
  unlockAll,
  type AlignMode,
  type CanvasElementLike,
  type SameSelectionMode,
  type VisualStyle,
  type ZOrderAction,
} from './selection-tools.ts'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

export type CanvasSelectionSnapshot = {
  elements: SceneElement[]
  selectedGroupIds: Record<string, boolean>
  editingGroupId: string | null
  objectsSnapModeEnabled: boolean
  gridModeEnabled: boolean
}

type Props = {
  api: ExcalidrawImperativeAPI | null
  selection: CanvasSelectionSnapshot
  disabled: boolean
  onNotice: (message: string) => void
}

function isRichTextAnchor(element: SceneElement): boolean {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData
  return Boolean(customData?.canvasRichText)
}

function selectedSet(api: ExcalidrawImperativeAPI): Set<string> {
  return new Set(Object.entries(api.getAppState().selectedElementIds).filter(([, selected]) => selected).map(([id]) => id))
}

function selectedGroupSet(api: ExcalidrawImperativeAPI): Set<string> {
  return new Set(Object.entries(api.getAppState().selectedGroupIds).filter(([, selected]) => selected).map(([id]) => id))
}

function relatedSelectionIds(elements: readonly SceneElement[], selected: Set<string>): Set<string> {
  const expanded = new Set(selected)
  const selectedFrames = new Set(elements.filter(element => selected.has(element.id) && element.type === 'frame').map(element => element.id))
  for (const element of elements) {
    if (element.frameId && selectedFrames.has(element.frameId)) expanded.add(element.id)
    if (!selected.has(element.id)) continue
    for (const bound of element.boundElements ?? []) if (bound.type === 'text') expanded.add(bound.id)
  }
  return expanded
}

function numeric(value: string): number | null {
  if (!value.trim()) return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

export function SelectionToolbar({ api, selection, disabled, onNotice }: Props) {
  const [copiedStyle, setCopiedStyle] = useState<VisualStyle | null>(null)
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [rotation, setRotation] = useState('0')
  const [aspectLocked, setAspectLocked] = useState(true)

  const selected = selection.elements
  const bounds = useMemo(() => commonBounds(selected as unknown as CanvasElementLike[]), [selected])
  const hasRichText = selected.some(isRichTextAnchor)
  const singleRichText = selected.length === 1 && hasRichText
  const grouped = Object.values(selection.selectedGroupIds).some(Boolean)

  useEffect(() => {
    if (!bounds) {
      setX(''); setY(''); setWidth(''); setHeight(''); setRotation('0')
      return
    }
    setX(String(Math.round(bounds.minX * 10) / 10))
    setY(String(Math.round(bounds.minY * 10) / 10))
    setWidth(String(Math.round(bounds.width * 10) / 10))
    setHeight(String(Math.round(bounds.height * 10) / 10))
    if (selected.length === 1) setRotation(String(Math.round((selected[0].angle * 180 / Math.PI) * 10) / 10))
    else setRotation('0')
  }, [bounds?.height, bounds?.minX, bounds?.minY, bounds?.width, selected])

  if (!api || !selected.length || singleRichText) return null

  const apply = (elements: CanvasElementLike[], appState?: Record<string, unknown>) => {
    api.updateScene({
      elements: elements as unknown as SceneElement[],
      ...(appState ? { appState } : {}),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }

  const currentElements = () => api.getSceneElementsIncludingDeleted() as unknown as CanvasElementLike[]

  const ids = () => selectedSet(api)
  const relatedIds = () => relatedSelectionIds(api.getSceneElementsIncludingDeleted(), ids())

  const group = () => {
    const result = groupSelection(currentElements(), ids())
    if (!Object.keys(result.selectedGroupIds).length) return
    apply(result.elements, { selectedElementIds: result.selectedIds, selectedGroupIds: result.selectedGroupIds, editingGroupId: null })
  }
  const ungroup = () => {
    const result = ungroupSelection(currentElements(), ids(), selectedGroupSet(api))
    if (!result.removedGroupIds.length) return
    apply(result.elements, { selectedGroupIds: {}, editingGroupId: null })
  }
  const lock = () => {
    const result = toggleLockSelection(currentElements(), relatedIds())
    apply(result.elements, result.locked ? { selectedElementIds: {}, selectedGroupIds: {} } : undefined)
    if (result.locked) onNotice('Locked selection. Use Canvas menu → Unlock all to unlock it.')
  }
  const duplicate = () => {
    const result = duplicateSelection(currentElements(), relatedIds())
    if (!Object.keys(result.duplicatedIds).length) return
    apply(result.elements, { selectedElementIds: result.duplicatedIds, selectedGroupIds: {}, editingGroupId: null })
  }
  const align = (mode: AlignMode) => apply(alignSelection(currentElements(), ids(), mode))
  const distribute = (axis: 'x' | 'y') => apply(distributeSelection(currentElements(), ids(), axis))
  const arrange = (action: ZOrderAction) => apply(reorderSelection(currentElements(), relatedIds(), action))
  const flip = (axis: 'x' | 'y') => apply(flipSelection(currentElements(), ids(), axis))
  const resetAngle = () => apply(resetRotation(currentElements(), ids()))
  const selectMatching = (mode: SameSelectionMode) => {
    const selectedElementIds = selectSame(currentElements(), ids(), mode)
    api.updateScene({ appState: { selectedElementIds, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER })
  }
  const copyStyle = () => {
    const source = selected[0]
    if (!source) return
    setCopiedStyle(copyVisualStyle(source as unknown as CanvasElementLike))
    onNotice('Style copied.')
  }
  const pasteStyle = () => {
    if (!copiedStyle) return
    apply(pasteVisualStyle(currentElements(), ids(), copiedStyle))
  }
  const useAsDefault = () => {
    const source = selected[0] as unknown as CanvasElementLike | undefined
    if (!source) return
    api.updateScene({
      appState: {
        currentItemStrokeColor: source.strokeColor,
        currentItemBackgroundColor: source.backgroundColor,
        currentItemFillStyle: source.fillStyle,
        currentItemStrokeWidth: source.strokeWidth,
        currentItemStrokeStyle: source.strokeStyle,
        currentItemRoughness: source.roughness,
        currentItemOpacity: source.opacity,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    onNotice('Current object style will be used for new shapes.')
  }
  const resetStyle = () => apply(pasteVisualStyle(currentElements(), ids(), {
    strokeColor: '#1b1b1f',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: null,
  }))

  const commitPosition = () => apply(setSelectionPosition(currentElements(), ids(), numeric(x), numeric(y)))
  const commitWidth = () => {
    const nextWidth = numeric(width)
    if (nextWidth === null) return
    const nextHeight = aspectLocked && bounds && bounds.width > 0 ? nextWidth * bounds.height / bounds.width : numeric(height)
    apply(resizeSelection(currentElements(), ids(), nextWidth, nextHeight))
  }
  const commitHeight = () => {
    const nextHeight = numeric(height)
    if (nextHeight === null) return
    const nextWidth = aspectLocked && bounds && bounds.height > 0 ? nextHeight * bounds.width / bounds.height : numeric(width)
    apply(resizeSelection(currentElements(), ids(), nextWidth, nextHeight))
  }
  const commitRotation = () => apply(rotateSelection(currentElements(), ids(), numeric(rotation) ?? 0, true))

  const toggleSnap = () => api.updateScene({
    appState: { objectsSnapModeEnabled: !selection.objectsSnapModeEnabled },
    captureUpdate: CaptureUpdateAction.NEVER,
  })
  const toggleGrid = () => api.updateScene({
    appState: { gridModeEnabled: !selection.gridModeEnabled },
    captureUpdate: CaptureUpdateAction.NEVER,
  })
  const selectFrameContents = () => {
    if (selected.length !== 1 || selected[0].type !== 'frame') return
    const frameId = selected[0].id
    const selectedElementIds = selectFrameContents(
      api.getSceneElementsIncludingDeleted() as unknown as CanvasElementLike[],
      frameId,
    )
    if (!Object.keys(selectedElementIds).length) {
      onNotice('This frame is empty.')
      return
    }
    api.updateScene({
      appState: { selectedElementIds, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
  }

  return <div className="selection-toolbar" role="toolbar" aria-label="Selection tools">
    <div className="selection-toolbar-primary">
      <span className="selection-count">{selected.length}</span>
      <button type="button" onClick={duplicate} disabled={disabled} title="Duplicate selection (Ctrl/⌘ D)">Duplicate</button>
      {grouped
        ? <button type="button" onClick={ungroup} disabled={disabled}>Ungroup</button>
        : <button type="button" onClick={group} disabled={disabled || selected.length < 2}>Group</button>}
      <button type="button" onClick={lock} disabled={disabled}>Lock</button>

      <details className="selection-popover">
        <summary>Align</summary>
        <div className="selection-popover-panel selection-grid">
          <button type="button" onClick={() => align('left')} disabled={selected.length < 2}>Left</button>
          <button type="button" onClick={() => align('centerX')} disabled={selected.length < 2}>Center X</button>
          <button type="button" onClick={() => align('right')} disabled={selected.length < 2}>Right</button>
          <button type="button" onClick={() => align('top')} disabled={selected.length < 2}>Top</button>
          <button type="button" onClick={() => align('centerY')} disabled={selected.length < 2}>Center Y</button>
          <button type="button" onClick={() => align('bottom')} disabled={selected.length < 2}>Bottom</button>
          <button type="button" onClick={() => distribute('x')} disabled={selected.length < 3}>Distribute H</button>
          <button type="button" onClick={() => distribute('y')} disabled={selected.length < 3}>Distribute V</button>
        </div>
      </details>

      <details className="selection-popover">
        <summary>Arrange</summary>
        <div className="selection-popover-panel selection-grid">
          <button type="button" onClick={() => arrange('front')}>Front</button>
          <button type="button" onClick={() => arrange('forward')}>Forward</button>
          <button type="button" onClick={() => arrange('backward')}>Backward</button>
          <button type="button" onClick={() => arrange('back')}>Back</button>
          <button type="button" onClick={() => flip('x')}>Flip H</button>
          <button type="button" onClick={() => flip('y')}>Flip V</button>
          <button type="button" onClick={resetAngle}>Reset rotation</button>
        </div>
      </details>

      <details className="selection-popover selection-transform-popover">
        <summary>Transform</summary>
        <div className="selection-popover-panel transform-panel">
          <label>X <input aria-label="Selection X" inputMode="decimal" value={x} onChange={event => setX(event.target.value)} onBlur={commitPosition} onKeyDown={event => { if (event.key === 'Enter') commitPosition() }} /></label>
          <label>Y <input aria-label="Selection Y" inputMode="decimal" value={y} onChange={event => setY(event.target.value)} onBlur={commitPosition} onKeyDown={event => { if (event.key === 'Enter') commitPosition() }} /></label>
          <label>W <input aria-label="Selection width" inputMode="decimal" value={width} onChange={event => setWidth(event.target.value)} onBlur={commitWidth} onKeyDown={event => { if (event.key === 'Enter') commitWidth() }} /></label>
          <label>H <input aria-label="Selection height" inputMode="decimal" value={height} onChange={event => setHeight(event.target.value)} onBlur={commitHeight} onKeyDown={event => { if (event.key === 'Enter') commitHeight() }} /></label>
          <button type="button" className={aspectLocked ? 'is-active' : ''} aria-pressed={aspectLocked} onClick={() => setAspectLocked(value => !value)} title="Lock aspect ratio">Ratio</button>
          <label>{selected.length === 1 ? '°' : 'Δ°'} <input aria-label="Selection rotation" inputMode="decimal" value={rotation} onChange={event => setRotation(event.target.value)} onBlur={commitRotation} onKeyDown={event => { if (event.key === 'Enter') commitRotation() }} /></label>
        </div>
      </details>

      <button type="button" className={selection.objectsSnapModeEnabled ? 'is-active' : ''} aria-pressed={selection.objectsSnapModeEnabled} onClick={toggleSnap} title="Object snapping and smart guides">Snap</button>
      <button type="button" className={selection.gridModeEnabled ? 'is-active' : ''} aria-pressed={selection.gridModeEnabled} onClick={toggleGrid} title="Grid and grid snapping">Grid</button>

      <details className="selection-popover">
        <summary>More</summary>
        <div className="selection-popover-panel selection-more-panel">
          <div className="selection-section"><strong>Selection</strong>
            <button type="button" onClick={selectFrameContents} disabled={selected.length !== 1 || selected[0].type !== 'frame'}>Frame contents</button>
            <strong>Select same</strong>
            <button type="button" onClick={() => selectMatching('type')}>Type</button>
            <button type="button" onClick={() => selectMatching('stroke')}>Stroke color</button>
            <button type="button" onClick={() => selectMatching('fill')}>Fill color</button>
          </div>
          <div className="selection-section"><strong>Style</strong>
            <button type="button" onClick={copyStyle} disabled={hasRichText}>Copy style</button>
            <button type="button" onClick={pasteStyle} disabled={!copiedStyle || hasRichText}>Paste style</button>
            <button type="button" onClick={useAsDefault} disabled={hasRichText}>Set as default</button>
            <button type="button" onClick={resetStyle} disabled={hasRichText}>Reset style</button>
          </div>
        </div>
      </details>
    </div>
  </div>
}

export function unlockAllElements(api: ExcalidrawImperativeAPI): number {
  const result = unlockAll(api.getSceneElementsIncludingDeleted() as unknown as CanvasElementLike[])
  const count = Object.keys(result.selectedIds).length
  if (!count) return 0
  api.updateScene({
    elements: result.elements as unknown as SceneElement[],
    appState: { selectedElementIds: result.selectedIds, selectedGroupIds: {}, editingGroupId: null },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  return count
}
