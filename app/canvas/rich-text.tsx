import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

type RichTextData = {
  version: 1
  html: string
}

type RichTextSnapshot = {
  elements: SceneElement[]
  selectedIds: Record<string, boolean>
  scrollX: number
  scrollY: number
  zoom: number
}

export type RichTextLayerHandle = {
  sync: (elements: readonly SceneElement[], appState: AppState) => void
  beginEditing: (elementId: string) => void
  editSelected: () => boolean
}

export type RichTextCreateOptions = {
  x: number
  y: number
  width?: number
  height?: number
  html?: string
}

const RICH_TEXT_KEY = 'canvasRichText'
const MAX_HTML_LENGTH = 96_000
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 120
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 200
const DEFAULT_FONT_SIZE = 20

export const RICH_TEXT_FONTS = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Arial, sans-serif' },
  { label: 'Candara', value: 'Candara, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Arial, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Arial, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Arial, sans-serif' },
  { label: 'Century Gothic', value: '"Century Gothic", Arial, sans-serif' },
  { label: 'Franklin Gothic', value: '"Franklin Gothic Medium", Arial, sans-serif' },
  { label: 'Gill Sans', value: '"Gill Sans", Arial, sans-serif' },
  { label: 'Lucida Sans', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, "Times New Roman", serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Book Antiqua', value: '"Book Antiqua", Palatino, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Baskerville', value: 'Baskerville, Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Monaco', value: 'Monaco, Consolas, monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", Monaco, monospace' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { label: 'Brush Script MT', value: '"Brush Script MT", cursive' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Excalifont', value: 'Excalifont, cursive' },
  { label: 'Nunito', value: 'Nunito, Arial, sans-serif' },
  { label: 'Comic Shanns', value: '"Comic Shanns", monospace' },
  { label: 'Lilita One', value: '"Lilita One", Arial, sans-serif' },
  { label: 'Liberation Sans', value: '"Liberation Sans", Arial, sans-serif' },
] as const

export const RICH_TEXT_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120, 144] as const

const TEXT_COLORS = ['#111827', '#374151', '#6b7280', '#ffffff', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'] as const
const HIGHLIGHT_COLORS = ['#fff3bf', '#ffec99', '#ffd8a8', '#ffc9c9', '#d0bfff', '#bac8ff', '#a5d8ff', '#c3fae8', '#b2f2bb', '#e9ecef'] as const

function richData(element: SceneElement): RichTextData | null {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData
  if (!customData) return null
  const value = customData[RICH_TEXT_KEY]
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.html !== 'string') return null
  return { version: 1, html: candidate.html }
}

export function isRichTextElement(element: SceneElement): boolean {
  return element.type === 'rectangle' && !element.isDeleted && richData(element) !== null
}

function randomVersionNonce(): number {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  return Math.floor(Math.random() * 0x7fffffff)
}

function cleanFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

function fontFamilyFromStyle(value: string): string | null {
  if (!value) return null
  const normalized = value.replace(/["']/g, '').toLowerCase().replace(/\s+/g, ' ')
  for (const font of RICH_TEXT_FONTS) {
    const firstFamily = font.value.split(',')[0].replace(/["']/g, '').toLowerCase().trim()
    if (normalized.includes(firstFamily)) return font.value
  }
  return null
}

function safeColor(value: string): string | null {
  if (!value || value.length > 64 || /url\s*\(/i.test(value)) return null
  if (typeof CSS !== 'undefined' && CSS.supports?.('color', value)) return value
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : null
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

export function plainTextToRichHtml(value: string): string {
  return escapeHtml(value.replace(/\u200b/g, '')).replace(/\r?\n/g, '<br>')
}

function appendSanitizedNode(node: Node, target: HTMLElement) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\u200b/g, '')
    if (text) target.append(document.createTextNode(text))
    return
  }
  if (!(node instanceof HTMLElement)) return
  if (node.tagName === 'BR') {
    target.append(document.createElement('br'))
    return
  }
  if (node.tagName === 'DIV' || node.tagName === 'P') {
    const fragment = document.createDocumentFragment()
    for (const child of Array.from(node.childNodes)) {
      const holder = document.createElement('span')
      appendSanitizedNode(child, holder)
      while (holder.firstChild) fragment.append(holder.firstChild)
    }
    target.append(fragment)
    if (node.nextSibling) target.append(document.createElement('br'))
    return
  }

  const span = document.createElement('span')
  const style = node.style
  const tag = node.tagName

  const family = fontFamilyFromStyle(style.fontFamily || (tag === 'FONT' ? node.getAttribute('face') ?? '' : ''))
  if (family) span.style.fontFamily = family

  const sizeValue = style.fontSize ? Number.parseFloat(style.fontSize) : Number.NaN
  if (Number.isFinite(sizeValue) && style.fontSize.endsWith('px')) span.style.fontSize = `${cleanFontSize(sizeValue)}px`
  else if (Number.isFinite(sizeValue) && style.fontSize.endsWith('em') && sizeValue >= 0.5 && sizeValue <= 2) span.style.fontSize = `${sizeValue}em`

  const color = safeColor(style.color || (tag === 'FONT' ? node.getAttribute('color') ?? '' : ''))
  if (color) span.style.color = color

  const background = safeColor(style.backgroundColor)
  if (background) span.style.backgroundColor = background

  const weight = style.fontWeight
  if (tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600) span.style.fontWeight = '700'
  if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') span.style.fontStyle = 'italic'

  const decorations = new Set<string>()
  const decorationText = `${style.textDecoration} ${style.textDecorationLine}`
  if (tag === 'U' || decorationText.includes('underline')) decorations.add('underline')
  if (tag === 'S' || tag === 'STRIKE' || decorationText.includes('line-through')) decorations.add('line-through')
  if (decorations.size) span.style.textDecorationLine = [...decorations].join(' ')
  if (tag === 'SUB' || style.verticalAlign === 'sub') {
    span.style.verticalAlign = 'sub'
    span.style.fontSize = span.style.fontSize || '0.8em'
  }
  if (tag === 'SUP' || style.verticalAlign === 'super') {
    span.style.verticalAlign = 'super'
    span.style.fontSize = span.style.fontSize || '0.8em'
  }

  for (const child of Array.from(node.childNodes)) appendSanitizedNode(child, span)
  if (span.childNodes.length) target.append(span)
}

export function sanitizeRichTextHtml(html: string): string {
  if (typeof document === 'undefined') return plainTextToRichHtml(html.slice(0, MAX_HTML_LENGTH))
  const source = document.createElement('div')
  source.innerHTML = html
  const target = document.createElement('div')
  for (const child of Array.from(source.childNodes)) appendSanitizedNode(child, target)
  const sanitized = target.innerHTML
  if (sanitized.length <= MAX_HTML_LENGTH) return sanitized
  return plainTextToRichHtml((target.textContent ?? '').slice(0, 60_000))
}

export function createRichTextElement(options: RichTextCreateOptions): SceneElement {
  const width = Math.max(120, options.width ?? DEFAULT_WIDTH)
  const height = Math.max(48, options.height ?? DEFAULT_HEIGHT)
  const [base] = convertToExcalidrawElements([{
    type: 'rectangle',
    x: options.x,
    y: options.y,
    width,
    height,
    strokeColor: '#ffffff',
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    opacity: 1,
  }]) as unknown as SceneElement[]
  if (!base) throw new Error('Could not create rich text anchor')
  const customData = (base as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...base,
    customData: {
      ...customData,
      [RICH_TEXT_KEY]: { version: 1, html: sanitizeRichTextHtml(options.html ?? '') } satisfies RichTextData,
    },
  } as SceneElement
}

function updatedRichTextElement(element: SceneElement, html: string, minHeight: number): SceneElement {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...element,
    height: Math.max(element.height, minHeight),
    version: element.version + 1,
    versionNonce: randomVersionNonce(),
    updated: Date.now(),
    customData: {
      ...customData,
      [RICH_TEXT_KEY]: { version: 1, html: sanitizeRichTextHtml(html) } satisfies RichTextData,
    },
  } as SceneElement
}

function selectionInside(editor: HTMLElement, range: Range | null): range is Range {
  if (!range) return false
  const node = range.commonAncestorContainer
  return node === editor || editor.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node)
}

function positionStyle(element: SceneElement, snapshot: RichTextSnapshot): CSSProperties {
  const zoom = Math.max(0.01, snapshot.zoom)
  const centerX = (element.x + element.width / 2 + snapshot.scrollX) * zoom
  const centerY = (element.y + element.height / 2 + snapshot.scrollY) * zoom
  return {
    width: element.width,
    height: element.height,
    left: centerX - element.width / 2,
    top: centerY - element.height / 2,
    transform: `scale(${zoom}) rotate(${element.angle}rad)`,
    transformOrigin: 'center center',
  }
}

export const RichTextLayer = forwardRef<RichTextLayerHandle, { api: ExcalidrawImperativeAPI | null; disabled: boolean }>(function RichTextLayer({ api, disabled }, ref) {
  const [snapshot, setSnapshot] = useState<RichTextSnapshot>({ elements: [], selectedIds: {}, scrollX: 0, scrollY: 0, zoom: 1 })
  const snapshotRef = useRef(snapshot)
  const pendingSnapshotRef = useRef<RichTextSnapshot | null>(null)
  const syncFrameRef = useRef<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const selectionRef = useRef<Range | null>(null)
  const [fontFamily, setFontFamily] = useState<string>(RICH_TEXT_FONTS[0].value)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [textColor, setTextColor] = useState('#111827')
  const [highlightColor, setHighlightColor] = useState('#fff3bf')

  useEffect(() => {
    snapshotRef.current = snapshot
    const selectedRich = snapshot.elements.find(element => snapshot.selectedIds[element.id])
    if (selectedRich) document.documentElement.dataset.canvasRichTextSelected = 'true'
    else delete document.documentElement.dataset.canvasRichTextSelected
    return () => { delete document.documentElement.dataset.canvasRichTextSelected }
  }, [snapshot])

  useEffect(() => () => {
    if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current)
  }, [])

  const sync = (elements: readonly SceneElement[], appState: AppState) => {
    const richElements = elements.filter(isRichTextElement)
    if (richElements.length === 0 && snapshotRef.current.elements.length === 0) return
    pendingSnapshotRef.current = {
      elements: richElements,
      selectedIds: { ...appState.selectedElementIds },
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom.value,
    }
    if (syncFrameRef.current !== null) return
    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null
      const next = pendingSnapshotRef.current
      pendingSnapshotRef.current = null
      if (next) setSnapshot(next)
    })
  }

  const focusAtEnd = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = range.cloneRange()
  }

  const beginEditing = (elementId: string) => {
    if (disabled) return
    const element = snapshotRef.current.elements.find(item => item.id === elementId)
      ?? api?.getSceneElementsIncludingDeleted().find(item => item.id === elementId)
    if (!element || !isRichTextElement(element)) return
    api?.updateScene({ appState: { selectedElementIds: { [elementId]: true } } })
    if (api) {
      const appState = api.getAppState()
      const immediate: RichTextSnapshot = {
        elements: api.getSceneElementsIncludingDeleted().filter(isRichTextElement),
        selectedIds: { [elementId]: true },
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      }
      snapshotRef.current = immediate
      setSnapshot(immediate)
    }
    setEditingId(elementId)
    requestAnimationFrame(focusAtEnd)
  }

  const selectedRich = useMemo(() => snapshot.elements.find(element => snapshot.selectedIds[element.id]) ?? null, [snapshot])

  useImperativeHandle(ref, () => ({
    sync,
    beginEditing,
    editSelected: () => {
      const selected = snapshotRef.current.elements.find(element => snapshotRef.current.selectedIds[element.id])
      if (!selected) return false
      beginEditing(selected.id)
      return true
    },
  }))

  useEffect(() => {
    if (!editingId) return
    const current = snapshot.elements.find(element => element.id === editingId)
    if (!current) setEditingId(null)
  }, [editingId, snapshot.elements])

  useEffect(() => {
    if (!editingId) return
    const selectionChange = () => {
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection?.rangeCount) return
      const range = selection.getRangeAt(0)
      if (selectionInside(editor, range)) selectionRef.current = range.cloneRange()
    }
    document.addEventListener('selectionchange', selectionChange)
    return () => document.removeEventListener('selectionchange', selectionChange)
  }, [editingId])

  const commit = () => {
    if (!editingId || !api) return
    const editor = editorRef.current
    const current = api.getSceneElementsIncludingDeleted().find(element => element.id === editingId)
    if (!editor || !current || !isRichTextElement(current)) return
    const next = updatedRichTextElement(current, editor.innerHTML, Math.max(DEFAULT_HEIGHT, editor.scrollHeight + 12))
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map(element => element.id === next.id ? next : element),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }

  const finishEditing = () => {
    commit()
    setEditingId(null)
    selectionRef.current = null
    api?.setActiveTool({ type: 'selection' })
  }

  const restoreSelection = (): Range | null => {
    const editor = editorRef.current
    if (!editor) return null
    editor.focus({ preventScroll: true })
    const saved = selectionRef.current
    const selection = window.getSelection()
    if (saved && selectionInside(editor, saved)) {
      selection?.removeAllRanges()
      selection?.addRange(saved)
      return saved
    }
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = range.cloneRange()
    return range
  }

  const rememberSelection = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (selectionInside(editor, range)) selectionRef.current = range.cloneRange()
  }

  const applyCommand = (command: string) => {
    if (!editingId) return
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(command, false)
    rememberSelection()
  }

  const applyInlineStyle = (styles: Partial<CSSStyleDeclaration>) => {
    if (!editingId) return
    const editor = editorRef.current
    const range = restoreSelection()
    if (!editor || !range || !selectionInside(editor, range)) return
    const span = document.createElement('span')
    Object.assign(span.style, styles)
    if (range.collapsed) {
      const marker = document.createTextNode('\u200b')
      span.append(marker)
      range.insertNode(span)
      const nextRange = document.createRange()
      nextRange.setStart(marker, 1)
      nextRange.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(nextRange)
      selectionRef.current = nextRange.cloneRange()
    } else {
      const fragment = range.extractContents()
      span.append(fragment)
      range.insertNode(span)
      const nextRange = document.createRange()
      nextRange.selectNodeContents(span)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(nextRange)
      selectionRef.current = nextRange.cloneRange()
    }
    editor.focus({ preventScroll: true })
  }

  const applyFont = (value: string) => {
    setFontFamily(value)
    applyInlineStyle({ fontFamily: value })
  }
  const applySize = (value: number) => {
    const next = cleanFontSize(value)
    setFontSize(next)
    applyInlineStyle({ fontSize: `${next}px` })
  }
  const applyTextColor = (value: string) => {
    setTextColor(value)
    applyInlineStyle({ color: value })
  }
  const applyHighlight = (value: string) => {
    setHighlightColor(value)
    applyInlineStyle({ backgroundColor: value })
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rich = event.clipboardData.getData('text/html')
    const plain = event.clipboardData.getData('text/plain')
    const html = rich ? sanitizeRichTextHtml(rich) : plainTextToRichHtml(plain)
    restoreSelection()
    document.execCommand('insertHTML', false, html)
    rememberSelection()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const modifier = event.metaKey || event.ctrlKey
    if (event.key === 'Escape' || (modifier && event.key === 'Enter')) {
      event.preventDefault()
      finishEditing()
      return
    }
    if (!modifier) return
    if (event.key.toLowerCase() === 'b') { event.preventDefault(); applyCommand('bold') }
    if (event.key.toLowerCase() === 'i') { event.preventDefault(); applyCommand('italic') }
    if (event.key.toLowerCase() === 'u') { event.preventDefault(); applyCommand('underline') }
  }

  const handleEditorBlur = (_event: FocusEvent<HTMLDivElement>) => {
    window.setTimeout(() => {
      const active = document.activeElement
      if (toolbarRef.current?.contains(active) || editorRef.current?.contains(active)) return
      finishEditing()
    }, 0)
  }

  return <>
    <div className="rich-text-layer" aria-label="Rich text layer">
      {snapshot.elements.map(element => {
        const data = richData(element)
        if (!data) return null
        const editing = editingId === element.id
        const html = sanitizeRichTextHtml(data.html)
        return <div key={element.id} className={`rich-text-block${editing ? ' is-editing' : ''}`} style={positionStyle(element, snapshot)} data-rich-text-id={element.id}>
          {editing
            ? <div
                ref={editorRef}
                className="rich-text-content rich-text-editor"
                contentEditable
                suppressContentEditableWarning
                spellCheck
                dangerouslySetInnerHTML={{ __html: html }}
                onPaste={handlePaste}
                onDrop={event => event.preventDefault()}
                onKeyDown={handleKeyDown}
                onBlur={handleEditorBlur}
              />
            : <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      })}
    </div>

    {selectedRich && <div ref={toolbarRef} className="rich-text-toolbar" role="toolbar" aria-label="Rich text formatting">
      {!editingId && <button type="button" className="rich-text-edit-button" onClick={() => beginEditing(selectedRich.id)}>Edit text</button>}
      <button type="button" aria-label="Bold" title="Bold (Ctrl/⌘ B)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('bold')}><strong>B</strong></button>
      <button type="button" aria-label="Italic" title="Italic (Ctrl/⌘ I)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('italic')}><em>I</em></button>
      <button type="button" aria-label="Underline" title="Underline (Ctrl/⌘ U)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('underline')}><u>U</u></button>
      <button type="button" aria-label="Strikethrough" title="Strikethrough" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('strikeThrough')}><s>S</s></button>
      <button type="button" aria-label="Subscript" title="Subscript" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('subscript')}>x₂</button>
      <button type="button" aria-label="Superscript" title="Superscript" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('superscript')}>x²</button>

      <label className="rich-text-control rich-text-font-control">Font
        <select value={fontFamily} disabled={!editingId} onChange={event => applyFont(event.target.value)}>
          {RICH_TEXT_FONTS.map(font => <option key={font.label} value={font.value} style={{ fontFamily: font.value }}>{font.label}</option>)}
        </select>
      </label>

      <label className="rich-text-control rich-text-size-control">Size
        <input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} list="canvas-rich-text-sizes" value={fontSize} disabled={!editingId} onChange={event => setFontSize(cleanFontSize(Number(event.target.value)))} onBlur={() => applySize(fontSize)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applySize(fontSize) } }} />
        <datalist id="canvas-rich-text-sizes">{RICH_TEXT_FONT_SIZES.map(size => <option key={size} value={size} />)}</datalist>
      </label>

      <div className="rich-text-color-group" aria-label="Text colors">
        <span>Text</span>
        {TEXT_COLORS.map(color => <button key={color} type="button" className="rich-text-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Text color ${color}`} disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyTextColor(color)} />)}
        <input type="color" aria-label="Custom text color" title="Custom text color" value={textColor} disabled={!editingId} onChange={event => applyTextColor(event.target.value)} />
      </div>

      <div className="rich-text-color-group" aria-label="Highlight colors">
        <span>Highlight</span>
        {HIGHLIGHT_COLORS.map(color => <button key={color} type="button" className="rich-text-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Highlight ${color}`} disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyHighlight(color)} />)}
        <input type="color" aria-label="Custom highlight color" title="Custom highlight color" value={highlightColor} disabled={!editingId} onChange={event => applyHighlight(event.target.value)} />
        <button type="button" className="rich-text-clear-highlight" title="Remove highlight" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineStyle({ backgroundColor: 'transparent' })}>×</button>
      </div>

      <button type="button" title="Clear formatting" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('removeFormat')}>Clear</button>
      {editingId && <button type="button" className="rich-text-done-button" onMouseDown={event => event.preventDefault()} onClick={finishEditing}>Done</button>}
    </div>}
  </>
})
