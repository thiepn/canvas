import { CaptureUpdateAction, ROUNDNESS, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  alignSelection,
  bindConnectorEndpoint,
  commonBounds,
  copyVisualStyle,
  detachConnectorEndpoint,
  distributeSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  pasteVisualStyle,
  reorderSelection,
  reverseConnector,
  resetRotation,
  resizeSelection,
  rotateSelection,
  selectFrameContents,
  selectSame,
  setConnectorArrowheads,
  setConnectorRouting,
  setSelectionPosition,
  toggleLockSelection,
  ungroupSelection,
  unlockAll,
  type AlignMode,
  type CanvasElementLike,
  type ConnectorArrowhead,
  type ConnectorRouting,
  type SameSelectionMode,
  type VisualStyle,
  type ZOrderAction,
} from './selection-tools.ts'
import {
  canvasShapeData,
  isCanvasShapeElement,
  updateCanvasShapeElement,
  type CanvasShapeFillStyle,
  type CanvasShapeStrokeStyle,
} from './canvas-shapes.tsx'

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
  objectsSnapEnabled: boolean
  gridEnabled: boolean
  onObjectsSnapPreference: (enabled: boolean) => void
  onGridPreference: (enabled: boolean) => void
  onSelectionRefresh: () => void
  onManipulationCommit: () => void
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

function boundSelectionIds(elements: readonly SceneElement[], selected: Set<string>): Set<string> {
  const expanded = new Set(selected)
  for (const element of elements) {
    if (!selected.has(element.id)) continue
    for (const bound of element.boundElements ?? []) if (bound.type === 'text') expanded.add(bound.id)
  }
  return expanded
}

function relatedSelectionIds(elements: readonly SceneElement[], selected: Set<string>): Set<string> {
  const expanded = new Set(selected)
  const selectedFrames = new Set(elements.filter(element => selected.has(element.id) && element.type === 'frame').map(element => element.id))
  for (const element of elements) if (element.frameId && selectedFrames.has(element.frameId)) expanded.add(element.id)
  return boundSelectionIds(elements, expanded)
}

function numeric(value: string): number | null {
  if (!value.trim()) return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

const SHAPE_COLORS = ['#1f2937', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'] as const
const SHAPE_FILLS = ['#ffffff', '#fff3bf', '#ffe8cc', '#d3f9d8', '#c5f6fa', '#dbeafe', '#ede9fe', '#fce7f3', '#e5e7eb'] as const
const ARROWHEAD_OPTIONS: Array<{ value: ConnectorArrowhead; label: string }> = [
  { value: null, label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'bar', label: 'Bar' },
]

function isNativeShape(element: SceneElement): boolean {
  return (element.type === 'rectangle' && !isRichTextAnchor(element) && !isCanvasShapeElement(element))
    || element.type === 'ellipse'
    || element.type === 'diamond'
}

function isBindableShape(element: SceneElement): boolean {
  return isNativeShape(element) || isCanvasShapeElement(element)
}

function connectorRouting(element: SceneElement): ConnectorRouting {
  const arrow = element as SceneElement & { elbowed?: boolean; roundness?: { type?: number } | null }
  if (arrow.elbowed) return 'elbow'
  if (arrow.roundness?.type === 2) return 'curved'
  return 'straight'
}

function arrowheadValue(value: unknown): ConnectorArrowhead {
  return ARROWHEAD_OPTIONS.some(option => option.value === value) ? value as ConnectorArrowhead : null
}

export function SelectionToolbar({ api, selection, disabled, onNotice, objectsSnapEnabled, gridEnabled, onObjectsSnapPreference, onGridPreference, onSelectionRefresh, onManipulationCommit }: Props) {
  const [copiedStyle, setCopiedStyle] = useState<VisualStyle | null>(null)
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [rotation, setRotation] = useState('0')
  const [aspectLocked, setAspectLocked] = useState(true)
  const [connectorLabel, setConnectorLabel] = useState('')

  const selected = selection.elements
  const bounds = useMemo(() => commonBounds(selected as unknown as CanvasElementLike[]), [selected])
  const hasRichText = selected.some(isRichTextAnchor)
  const singleRichText = selected.length === 1 && hasRichText
  const hasLinear = selected.some(element => element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw')
  const shapeSelection = selected.filter(element => isNativeShape(element) || isCanvasShapeElement(element))
  const allShapes = shapeSelection.length > 0 && shapeSelection.length === selected.length
  const hasCanvasShape = selected.some(isCanvasShapeElement)
  const singleArrow = selected.length === 1 && selected[0].type === 'arrow' ? selected[0] : null
  const mixedArrow = selected.find(element => element.type === 'arrow') ?? null
  const connectorTarget = selected.length === 2 && mixedArrow
    ? selected.find(element => element.id !== mixedArrow.id && isBindableShape(element)) ?? null
    : null
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
  }, [bounds, selected])

  useEffect(() => {
    if (!api || !singleArrow) {
      setConnectorLabel('')
      return
    }
    const labelId = singleArrow.boundElements?.find(bound => bound.type === 'text')?.id
    const label = labelId ? api.getSceneElementsIncludingDeleted().find(element => element.id === labelId) : null
    setConnectorLabel(label?.type === 'text' ? label.text : '')
  }, [api, singleArrow?.id, singleArrow?.version])

  if (!api || !selected.length || singleRichText) return null

  const commitManipulation = () => requestAnimationFrame(onManipulationCommit)
  const apply = (elements: CanvasElementLike[]) => {
    api.updateScene({
      elements: elements as unknown as SceneElement[],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    commitManipulation()
  }

  const currentElements = () => api.getSceneElementsIncludingDeleted() as unknown as CanvasElementLike[]
  const refreshSelection = () => requestAnimationFrame(onSelectionRefresh)

  const ids = () => selectedSet(api)
  const relatedIds = () => relatedSelectionIds(api.getSceneElementsIncludingDeleted(), ids())
  const geometryIds = () => relatedIds()

  const group = () => {
    const result = groupSelection(currentElements(), geometryIds())
    if (!Object.keys(result.selectedGroupIds).length) return
    api.updateScene({
      elements: result.elements as unknown as SceneElement[],
      appState: { selectedElementIds: result.selectedIds, selectedGroupIds: result.selectedGroupIds, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    refreshSelection()
    commitManipulation()
  }
  const ungroup = () => {
    const result = ungroupSelection(currentElements(), ids(), selectedGroupSet(api))
    if (!result.removedGroupIds.length) return
    api.updateScene({
      elements: result.elements as unknown as SceneElement[],
      appState: { selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    refreshSelection()
    commitManipulation()
  }
  const lock = () => {
    const result = toggleLockSelection(currentElements(), relatedIds())
    api.updateScene({
      elements: result.elements as unknown as SceneElement[],
      ...(result.locked ? { appState: { selectedElementIds: {}, selectedGroupIds: {} } } : {}),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    refreshSelection()
    commitManipulation()
    if (result.locked) onNotice('Locked selection. Use Canvas menu → Unlock all to unlock it.')
  }
  const duplicate = () => {
    const result = duplicateSelection(currentElements(), relatedIds())
    if (!Object.keys(result.duplicatedIds).length) return
    api.updateScene({
      elements: result.elements as unknown as SceneElement[],
      appState: { selectedElementIds: result.duplicatedIds, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    refreshSelection()
    commitManipulation()
  }
  const align = (mode: AlignMode) => apply(alignSelection(currentElements(), geometryIds(), mode))
  const distribute = (axis: 'x' | 'y') => apply(distributeSelection(currentElements(), geometryIds(), axis))
  const arrange = (action: ZOrderAction) => apply(reorderSelection(currentElements(), relatedIds(), action))
  const flip = (axis: 'x' | 'y') => apply(flipSelection(currentElements(), geometryIds(), axis))
  const resetAngle = () => apply(resetRotation(currentElements(), geometryIds()))
  const selectMatching = (mode: SameSelectionMode) => {
    const selectedElementIds = selectSame(currentElements(), ids(), mode)
    api.updateScene({ appState: { selectedElementIds, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER })
    refreshSelection()
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
    const source = selected[0]
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

  const applyShapeStyle = (patch: {
    strokeColor?: string
    fillColor?: string
    fillMode?: CanvasShapeFillStyle
    strokeStyle?: CanvasShapeStrokeStyle
    strokeWidth?: number
    opacity?: number
    cornerRadius?: number
  }) => {
    const selectedIds = ids()
    const next = api.getSceneElementsIncludingDeleted().map(element => {
      if (!selectedIds.has(element.id) || element.isDeleted) return element
      if (isCanvasShapeElement(element)) {
        const style: Record<string, unknown> = {}
        if (patch.strokeColor !== undefined) style.strokeColor = patch.strokeColor
        if (patch.fillColor !== undefined) style.fillColor = patch.fillColor
        if (patch.fillMode !== undefined) style.fillStyle = patch.fillMode
        if (patch.strokeStyle !== undefined) style.strokeStyle = patch.strokeStyle
        if (patch.strokeWidth !== undefined) style.strokeWidth = patch.strokeWidth
        if (patch.opacity !== undefined) style.opacity = patch.opacity
        if (patch.cornerRadius !== undefined) style.cornerRadius = patch.cornerRadius
        return updateCanvasShapeElement(element, { style })
      }
      if (!isNativeShape(element)) return element
      let updated = element
      if (patch.strokeColor !== undefined) updated = newElementWith(updated, { strokeColor: patch.strokeColor })
      if (patch.fillColor !== undefined) updated = newElementWith(updated, { backgroundColor: patch.fillColor })
      if (patch.strokeStyle !== undefined) updated = newElementWith(updated, { strokeStyle: patch.strokeStyle })
      if (patch.strokeWidth !== undefined) updated = newElementWith(updated, { strokeWidth: patch.strokeWidth })
      if (patch.opacity !== undefined) updated = newElementWith(updated, { opacity: patch.opacity })
      if (patch.fillMode !== undefined) {
        updated = newElementWith(updated, {
          backgroundColor: patch.fillMode === 'transparent'
            ? 'transparent'
            : updated.backgroundColor === 'transparent' ? '#e7f5ff' : updated.backgroundColor,
          fillStyle: patch.fillMode === 'hachure' ? 'hachure' : 'solid',
        })
      }
      if (patch.cornerRadius !== undefined && updated.type === 'rectangle') {
        updated = newElementWith(updated, {
          roundness: patch.cornerRadius <= 0 ? null : { type: ROUNDNESS.ADAPTIVE_RADIUS, value: patch.cornerRadius },
        })
      }
      return updated
    })
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    commitManipulation()
  }

  const applyConnectorRouting = (routing: ConnectorRouting) => apply(setConnectorRouting(currentElements(), ids(), routing))
  const applyConnectorHeads = (start: ConnectorArrowhead, end: ConnectorArrowhead) => apply(setConnectorArrowheads(currentElements(), ids(), start, end))
  const reverseSelectedConnector = () => {
    if (!mixedArrow) return
    apply(reverseConnector(currentElements(), mixedArrow.id))
  }
  const bindSelectedConnector = (endpoint: 'start' | 'end') => {
    if (!mixedArrow || !connectorTarget) return
    apply(bindConnectorEndpoint(currentElements(), mixedArrow.id, connectorTarget.id, endpoint))
  }
  const detachSelectedConnector = (endpoint: 'start' | 'end') => {
    if (!mixedArrow) return
    apply(detachConnectorEndpoint(currentElements(), mixedArrow.id, endpoint))
  }

  const commitConnectorLabel = () => {
    if (!singleArrow) return
    const scene = api.getSceneElementsIncludingDeleted()
    const oldLabelId = singleArrow.boundElements?.find(bound => bound.type === 'text')?.id
    const oldLabel = oldLabelId ? scene.find(element => element.id === oldLabelId) : null
    const value = connectorLabel.trim()
    let nextArrow: SceneElement = singleArrow
    const withoutOldText = (singleArrow.boundElements ?? []).filter(bound => bound.type !== 'text')

    if (!value) {
      nextArrow = newElementWith(singleArrow, { boundElements: withoutOldText.length ? withoutOldText : null })
      const next = scene.map(element => {
        if (element.id === nextArrow.id) return nextArrow
        if (oldLabel && element.id === oldLabel.id) return newElementWith(oldLabel, { isDeleted: true })
        return element
      })
      api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
      commitManipulation()
      return
    }

    const generated = convertToExcalidrawElements([{
      type: 'arrow',
      x: singleArrow.x,
      y: singleArrow.y,
      points: singleArrow.points,
      strokeColor: singleArrow.strokeColor,
      strokeWidth: singleArrow.strokeWidth,
      strokeStyle: singleArrow.strokeStyle,
      roughness: singleArrow.roughness,
      opacity: singleArrow.opacity,
      startArrowhead: singleArrow.startArrowhead,
      endArrowhead: singleArrow.endArrowhead,
      elbowed: Boolean((singleArrow as SceneElement & { elbowed?: boolean }).elbowed),
      label: { text: value, fontSize: 16 },
    }])
    const generatedText = generated.find(element => element.type === 'text')
    if (!generatedText || generatedText.type !== 'text') return
    const label = {
      ...generatedText,
      containerId: singleArrow.id,
      groupIds: singleArrow.groupIds,
      frameId: singleArrow.frameId,
    }
    nextArrow = newElementWith(singleArrow, {
      boundElements: [...withoutOldText, { id: label.id, type: 'text' }],
    })
    const next = scene.map(element => {
      if (element.id === nextArrow.id) return nextArrow
      if (oldLabel && element.id === oldLabel.id) return newElementWith(oldLabel, { isDeleted: true })
      return element
    })
    next.push(label as SceneElement)
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    commitManipulation()
  }

  const commitPosition = () => apply(setSelectionPosition(currentElements(), geometryIds(), numeric(x), numeric(y)))
  const commitWidth = () => {
    const nextWidth = numeric(width)
    if (nextWidth === null) return
    const nextHeight = aspectLocked && bounds && bounds.width > 0 ? nextWidth * bounds.height / bounds.width : numeric(height)
    apply(resizeSelection(currentElements(), geometryIds(), nextWidth, nextHeight))
  }
  const commitHeight = () => {
    const nextHeight = numeric(height)
    if (nextHeight === null) return
    const nextWidth = aspectLocked && bounds && bounds.height > 0 ? nextHeight * bounds.width / bounds.height : numeric(width)
    apply(resizeSelection(currentElements(), geometryIds(), nextWidth, nextHeight))
  }
  const commitRotation = () => apply(rotateSelection(currentElements(), geometryIds(), numeric(rotation) ?? 0, true))

  const toggleSnap = () => {
    const next = !objectsSnapEnabled
    api.updateScene({
      appState: {
        objectsSnapModeEnabled: next,
        gridModeEnabled: next ? false : gridEnabled,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    onObjectsSnapPreference(next)
    if (next && gridEnabled) onGridPreference(false)
    refreshSelection()
  }
  const toggleGrid = () => {
    const next = !gridEnabled
    api.updateScene({
      appState: {
        gridModeEnabled: next,
        objectsSnapModeEnabled: next ? false : objectsSnapEnabled,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    onGridPreference(next)
    if (next && objectsSnapEnabled) onObjectsSnapPreference(false)
    refreshSelection()
  }
  const selectContentsOfFrame = () => {
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
    refreshSelection()
  }

  const firstShape = allShapes ? shapeSelection[0] : null
  const firstCanvasShape = firstShape && isCanvasShapeElement(firstShape) ? canvasShapeData(firstShape) : null
  const shapeStrokeColor = firstCanvasShape?.style.strokeColor ?? firstShape?.strokeColor ?? '#1f2937'
  const shapeFillColor = firstCanvasShape?.style.fillColor ?? (firstShape?.backgroundColor === 'transparent' ? '#e7f5ff' : firstShape?.backgroundColor) ?? '#e7f5ff'
  const shapeStrokeWidth = firstCanvasShape?.style.strokeWidth ?? firstShape?.strokeWidth ?? 2
  const shapeStrokeStyle = firstCanvasShape?.style.strokeStyle ?? firstShape?.strokeStyle ?? 'solid'
  const shapeFillMode: CanvasShapeFillStyle = firstCanvasShape?.style.fillStyle
    ?? (firstShape?.backgroundColor === 'transparent' ? 'transparent' : firstShape?.fillStyle === 'hachure' ? 'hachure' : 'solid')
  const shapeOpacity = firstCanvasShape?.style.opacity ?? firstShape?.opacity ?? 100
  const nativeRoundness = firstShape?.type === 'rectangle' && firstShape.roundness
    ? Number((firstShape.roundness as { value?: number }).value ?? 32)
    : 0
  const shapeCornerRadius = firstCanvasShape?.style.cornerRadius ?? nativeRoundness
  const routing = singleArrow ? connectorRouting(singleArrow) : 'straight'
  const startHead = singleArrow ? arrowheadValue(singleArrow.startArrowhead) : null
  const endHead = singleArrow ? arrowheadValue(singleArrow.endArrowhead) : null

  return <div className="selection-toolbar" role="toolbar" aria-label="Selection tools">
    <div className="selection-toolbar-primary">
      <span className="selection-count">{selected.length}</span>
      <button type="button" onClick={duplicate} disabled={disabled} title="Duplicate selection (Ctrl/⌘ D)">Duplicate</button>
      {grouped
        ? <button type="button" onClick={ungroup} disabled={disabled}>Ungroup</button>
        : <button type="button" onClick={group} disabled={disabled || selected.length < 2 || selected.some(element => element.type === 'frame')}>Group</button>}
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
          <button type="button" onClick={() => flip('x')} disabled={hasLinear}>Flip H</button>
          <button type="button" onClick={() => flip('y')} disabled={hasLinear}>Flip V</button>
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

      {allShapes && <details className="selection-popover phase3-style-popover">
        <summary>Shape</summary>
        <div className="selection-popover-panel phase3-style-panel">
          <div className="phase3-field-row">
            <label>Stroke <input type="color" value={shapeStrokeColor} onChange={event => applyShapeStyle({ strokeColor: event.target.value })} /></label>
            <label>Fill <input type="color" value={shapeFillColor} onChange={event => applyShapeStyle({ fillColor: event.target.value })} /></label>
          </div>
          <div className="phase3-swatches" aria-label="Shape stroke colors">
            {SHAPE_COLORS.map(color => <button key={color} type="button" className="phase3-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Stroke ${color}`} onClick={() => applyShapeStyle({ strokeColor: color })} />)}
          </div>
          <div className="phase3-swatches" aria-label="Shape fill colors">
            {SHAPE_FILLS.map(color => <button key={color} type="button" className="phase3-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Fill ${color}`} onClick={() => applyShapeStyle({ fillColor: color, fillMode: 'solid' })} />)}
          </div>
          <div className="phase3-field-grid">
            <label>Fill
              <select value={shapeFillMode} onChange={event => applyShapeStyle({ fillMode: event.target.value as CanvasShapeFillStyle })}>
                <option value="transparent">Transparent</option><option value="solid">Solid</option><option value="hachure">Hatch</option>
              </select>
            </label>
            <label>Stroke
              <select value={shapeStrokeStyle} onChange={event => applyShapeStyle({ strokeStyle: event.target.value as CanvasShapeStrokeStyle })}>
                <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
              </select>
            </label>
            <label>Width <input type="number" min="0.5" max="20" step="0.5" value={shapeStrokeWidth} onChange={event => applyShapeStyle({ strokeWidth: Number(event.target.value) })} /></label>
            <label>Opacity <input type="number" min="5" max="100" step="5" value={shapeOpacity} onChange={event => applyShapeStyle({ opacity: Number(event.target.value) })} /></label>
            <label>Radius <input type="number" min="0" max="64" step="1" value={shapeCornerRadius} disabled={!shapeSelection.some(element => isCanvasShapeElement(element) || element.type === 'rectangle')} onChange={event => applyShapeStyle({ cornerRadius: Number(event.target.value) })} /></label>
          </div>
        </div>
      </details>}

      {mixedArrow && <details className="selection-popover phase3-connector-popover">
        <summary>Connector</summary>
        <div className="selection-popover-panel phase3-connector-panel">
          {singleArrow && <>
            <div className="phase3-section-title">ROUTING</div>
            <div className="phase3-button-row">
              {(['straight', 'curved', 'elbow'] as ConnectorRouting[]).map(mode => <button key={mode} type="button" className={routing === mode ? 'is-active' : ''} onClick={() => applyConnectorRouting(mode)}>{mode === 'straight' ? 'Straight' : mode === 'curved' ? 'Curved' : 'Elbow'}</button>)}
            </div>
            <div className="phase3-section-title">ENDS</div>
            <div className="phase3-field-row">
              <label>Start <select value={startHead ?? ''} onChange={event => applyConnectorHeads((event.target.value || null) as ConnectorArrowhead, endHead)}>{ARROWHEAD_OPTIONS.map(option => <option key={option.label} value={option.value ?? ''}>{option.label}</option>)}</select></label>
              <label>End <select value={endHead ?? ''} onChange={event => applyConnectorHeads(startHead, (event.target.value || null) as ConnectorArrowhead)}>{ARROWHEAD_OPTIONS.map(option => <option key={option.label} value={option.value ?? ''}>{option.label}</option>)}</select></label>
            </div>
            <div className="phase3-button-row">
              <button type="button" onClick={() => applyConnectorHeads(null, null)}>Line</button>
              <button type="button" onClick={() => applyConnectorHeads(null, 'arrow')}>Arrow</button>
              <button type="button" onClick={() => applyConnectorHeads('arrow', 'arrow')}>Both</button>
              <button type="button" onClick={reverseSelectedConnector}>Reverse</button>
            </div>
            <div className="phase3-section-title">LABEL</div>
            <div className="phase3-label-row">
              <input aria-label="Connector label" value={connectorLabel} maxLength={120} onChange={event => setConnectorLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitConnectorLabel() } }} placeholder="Add label…" />
              <button type="button" onClick={commitConnectorLabel}>Apply</button>
            </div>
            <div className="phase3-section-title">BINDING</div>
            <div className="phase3-button-row">
              <button type="button" onClick={() => detachSelectedConnector('start')} disabled={!singleArrow.startBinding}>Detach start</button>
              <button type="button" onClick={() => detachSelectedConnector('end')} disabled={!singleArrow.endBinding}>Detach end</button>
            </div>
            <p className="phase3-help">Drag an endpoint onto a shape for precise edge binding. Curved connectors can be reshaped by editing their points.</p>
          </>}
          {connectorTarget && <>
            <div className="phase3-section-title">BIND TO SELECTED SHAPE</div>
            <div className="phase3-button-row">
              <button type="button" onClick={() => bindSelectedConnector('start')}>Bind start</button>
              <button type="button" onClick={() => bindSelectedConnector('end')}>Bind end</button>
            </div>
          </>}
        </div>
      </details>}

      <button type="button" className={objectsSnapEnabled ? 'is-active' : ''} aria-pressed={objectsSnapEnabled} onClick={toggleSnap} title="Object snapping and smart guides">Snap</button>
      <button type="button" className={gridEnabled ? 'is-active' : ''} aria-pressed={gridEnabled} onClick={toggleGrid} title="Grid and grid snapping">Grid</button>

      <details className="selection-popover">
        <summary>More</summary>
        <div className="selection-popover-panel selection-more-panel">
          <div className="selection-section"><strong>Selection</strong>
            <button type="button" onClick={selectContentsOfFrame} disabled={selected.length !== 1 || selected[0].type !== 'frame'}>Frame contents</button>
            <strong>Select same</strong>
            <button type="button" onClick={() => selectMatching('type')}>Type</button>
            <button type="button" onClick={() => selectMatching('stroke')}>Stroke color</button>
            <button type="button" onClick={() => selectMatching('fill')}>Fill color</button>
          </div>
          <div className="selection-section"><strong>Style</strong>
            <button type="button" onClick={copyStyle} disabled={hasRichText || hasCanvasShape}>Copy style</button>
            <button type="button" onClick={pasteStyle} disabled={!copiedStyle || hasRichText || hasCanvasShape}>Paste style</button>
            <button type="button" onClick={useAsDefault} disabled={hasRichText || hasCanvasShape}>Set as default</button>
            <button type="button" onClick={resetStyle} disabled={hasRichText || hasCanvasShape}>Reset style</button>
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
