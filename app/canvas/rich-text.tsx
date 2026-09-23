import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

type RichTextAlign = 'left' | 'center' | 'right' | 'justify'
type RichTextVerticalAlign = 'top' | 'middle' | 'bottom'
type RichTextWidthMode = 'fixed' | 'auto'

type RichTextBlockStyle = {
  widthMode: RichTextWidthMode
  textAlign: RichTextAlign
  verticalAlign: RichTextVerticalAlign
  lineHeight: number
  letterSpacing: number
  paragraphSpacing: number
  backgroundColor: string
  padding: number
  opacity: number
  borderRadius: number
}

type RichTextData = {
  version: 2
  html: string
  block: RichTextBlockStyle
}

type RecentFormatting = {
  fonts: string[]
  sizes: number[]
  colors: string[]
  highlights: string[]
}

type InlineFormat = {
  fontFamily?: string
  fontSize?: string
  color?: string
  backgroundColor?: string
  fontWeight?: string
  fontStyle?: string
  textDecorationLine?: string
  verticalAlign?: string
}

type RichTextSnapshot = {
  elements: SceneElement[]
  selectedIds: Record<string, boolean>
  selectedLegacyText: SceneElement | null
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
  angle?: number
  html?: string
  block?: Partial<RichTextBlockStyle>
}

const RICH_TEXT_KEY = 'canvasRichText'
const RECENT_FORMATTING_KEY = 'canvas.richText.recent.v2'
const MAX_HTML_LENGTH = 96_000
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 120
const MIN_WIDTH = 120
const MAX_AUTO_WIDTH = 1200
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 200
const DEFAULT_FONT_SIZE = 20
const MAX_RECENT = 6

const DEFAULT_BLOCK_STYLE: RichTextBlockStyle = {
  widthMode: 'fixed',
  textAlign: 'left',
  verticalAlign: 'top',
  lineHeight: 1.35,
  letterSpacing: 0,
  paragraphSpacing: 8,
  backgroundColor: 'transparent',
  padding: 6,
  opacity: 1,
  borderRadius: 0,
}

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
const BLOCK_BACKGROUND_COLORS = ['transparent', '#ffffff', '#fff9db', '#fff0f6', '#f3f0ff', '#e7f5ff', '#ebfbee', '#f8f9fa', '#212529'] as const

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function cleanNumber(value: unknown, fallback: number, minimum: number, maximum: number, precision = 2): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const multiplier = 10 ** precision
  return Math.round(clamp(number, minimum, maximum) * multiplier) / multiplier
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function normalizeBlockStyle(value: unknown): RichTextBlockStyle {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    widthMode: cleanEnum(candidate.widthMode, ['fixed', 'auto'] as const, DEFAULT_BLOCK_STYLE.widthMode),
    textAlign: cleanEnum(candidate.textAlign, ['left', 'center', 'right', 'justify'] as const, DEFAULT_BLOCK_STYLE.textAlign),
    verticalAlign: cleanEnum(candidate.verticalAlign, ['top', 'middle', 'bottom'] as const, DEFAULT_BLOCK_STYLE.verticalAlign),
    lineHeight: cleanNumber(candidate.lineHeight, DEFAULT_BLOCK_STYLE.lineHeight, 0.8, 3, 2),
    letterSpacing: cleanNumber(candidate.letterSpacing, DEFAULT_BLOCK_STYLE.letterSpacing, -5, 20, 2),
    paragraphSpacing: cleanNumber(candidate.paragraphSpacing, DEFAULT_BLOCK_STYLE.paragraphSpacing, 0, 64, 1),
    backgroundColor: safeColor(String(candidate.backgroundColor ?? ''), true) ?? DEFAULT_BLOCK_STYLE.backgroundColor,
    padding: cleanNumber(candidate.padding, DEFAULT_BLOCK_STYLE.padding, 0, 64, 1),
    opacity: cleanNumber(candidate.opacity, DEFAULT_BLOCK_STYLE.opacity, 0.1, 1, 2),
    borderRadius: cleanNumber(candidate.borderRadius, DEFAULT_BLOCK_STYLE.borderRadius, 0, 48, 1),
  }
}

function richData(element: SceneElement): RichTextData | null {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData
  if (!customData) return null
  const value = customData[RICH_TEXT_KEY]
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.html !== 'string') return null
  if (candidate.version === 2) return { version: 2, html: candidate.html, block: normalizeBlockStyle(candidate.block) }
  if (candidate.version === 1) return { version: 2, html: candidate.html, block: { ...DEFAULT_BLOCK_STYLE } }
  return null
}

export function isRichTextElement(element: SceneElement): boolean {
  return element.type === 'rectangle' && !element.isDeleted && richData(element) !== null
}

function isLegacyTextElement(element: SceneElement): boolean {
  return element.type === 'text' && !element.isDeleted && richData(element) === null
}

function randomVersionNonce(): number {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
  return Math.floor(Math.random() * 0x7fffffff)
}

function cleanFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE
  return Math.round(clamp(value, MIN_FONT_SIZE, MAX_FONT_SIZE))
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

function safeColor(value: string, allowTransparent = false): string | null {
  if (allowTransparent && value === 'transparent') return value
  if (!value || value.length > 64 || /url\s*\(/i.test(value)) return null
  if (typeof CSS !== 'undefined' && CSS.supports?.('color', value)) return value
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : null
}

function resolveFont(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  const byLabel = RICH_TEXT_FONTS.find(font => font.label.toLowerCase() === normalized)
  if (byLabel) return byLabel.value
  const byValue = RICH_TEXT_FONTS.find(font => font.value.toLowerCase() === normalized)
  if (byValue) return byValue.value
  return fontFamilyFromStyle(value)
}

function fontLabel(value: string): string {
  return RICH_TEXT_FONTS.find(font => font.value === value)?.label ?? value.split(',')[0].replace(/["']/g, '').trim()
}

function safeHref(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null
  try {
    const base = typeof location === 'undefined' ? 'https://example.invalid/' : location.href
    const url = new URL(trimmed, base)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
    return url.href
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

export function plainTextToRichHtml(value: string): string {
  return value.replace(/\u200b/g, '').split(/\r?\n/).map(line => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('')
}

function appendChildren(source: Node, target: HTMLElement) {
  for (const child of Array.from(source.childNodes)) appendSanitizedNode(child, target)
}

function appendSanitizedNode(node: Node, target: HTMLElement) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\u200b/g, '')
    if (text) target.append(document.createTextNode(text))
    return
  }
  if (!(node instanceof HTMLElement)) return
  const tag = node.tagName
  if (tag === 'BR') { target.append(document.createElement('br')); return }

  if (tag === 'P' || tag === 'DIV') {
    const paragraph = document.createElement('p')
    appendChildren(node, paragraph)
    if (!paragraph.childNodes.length) paragraph.append(document.createElement('br'))
    target.append(paragraph)
    return
  }

  if (tag === 'UL' || tag === 'OL') {
    const list = document.createElement(tag.toLowerCase())
    for (const child of Array.from(node.children)) {
      if (child.tagName !== 'LI') continue
      const item = document.createElement('li')
      appendChildren(child, item)
      if (!item.childNodes.length) item.append(document.createElement('br'))
      list.append(item)
    }
    if (list.childNodes.length) target.append(list)
    return
  }

  if (tag === 'LI') {
    const item = document.createElement('li')
    appendChildren(node, item)
    if (item.childNodes.length) target.append(item)
    return
  }

  if (tag === 'A') {
    const href = safeHref(node.getAttribute('href') ?? '')
    if (!href) { appendChildren(node, target); return }
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer nofollow'
    appendChildren(node, anchor)
    if (anchor.childNodes.length) target.append(anchor)
    return
  }

  if (!['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'FONT'].includes(tag)) {
    appendChildren(node, target)
    return
  }

  const span = document.createElement('span')
  const style = node.style
  const family = fontFamilyFromStyle(style.fontFamily || (tag === 'FONT' ? node.getAttribute('face') ?? '' : ''))
  if (family) span.style.fontFamily = family
  const sizeValue = style.fontSize ? Number.parseFloat(style.fontSize) : Number.NaN
  if (Number.isFinite(sizeValue) && style.fontSize.endsWith('px')) span.style.fontSize = `${cleanFontSize(sizeValue)}px`
  else if (Number.isFinite(sizeValue) && style.fontSize.endsWith('em') && sizeValue >= 0.5 && sizeValue <= 3) span.style.fontSize = `${cleanNumber(sizeValue, 1, 0.5, 3)}em`
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
  if (tag === 'SUB' || style.verticalAlign === 'sub') { span.style.verticalAlign = 'sub'; span.style.fontSize = span.style.fontSize || '0.8em' }
  if (tag === 'SUP' || style.verticalAlign === 'super') { span.style.verticalAlign = 'super'; span.style.fontSize = span.style.fontSize || '0.8em' }
  appendChildren(node, span)
  if (span.childNodes.length) target.append(span)
}

export function sanitizeRichTextHtml(html: string): string {
  if (typeof document === 'undefined') return plainTextToRichHtml(html.slice(0, MAX_HTML_LENGTH))
  const source = document.createElement('template')
  source.innerHTML = html
  const target = document.createElement('div')
  for (const child of Array.from(source.content.childNodes)) appendSanitizedNode(child, target)
  const sanitized = target.innerHTML
  if (sanitized.length <= MAX_HTML_LENGTH) return sanitized
  return plainTextToRichHtml((target.textContent ?? '').slice(0, 60_000))
}

function richPayload(html: string, block?: Partial<RichTextBlockStyle>): RichTextData {
  return { version: 2, html: sanitizeRichTextHtml(html), block: normalizeBlockStyle({ ...DEFAULT_BLOCK_STYLE, ...block }) }
}

export function createRichTextElement(options: RichTextCreateOptions): SceneElement {
  const width = Math.max(MIN_WIDTH, options.width ?? DEFAULT_WIDTH)
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
    opacity: 0,
  }]) as unknown as SceneElement[]
  if (!base) throw new Error('Could not create rich text anchor')
  const customData = (base as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...base,
    angle: options.angle ?? base.angle,
    customData: { ...customData, [RICH_TEXT_KEY]: richPayload(options.html ?? '', options.block) },
  } as SceneElement
}

function updateRichTextElement(element: SceneElement, html: string, block: RichTextBlockStyle, dimensions?: { width?: number; height?: number }): SceneElement {
  const customData = (element as SceneElement & { customData?: Record<string, unknown> }).customData ?? {}
  return {
    ...element,
    ...(dimensions?.width !== undefined ? { width: Math.max(MIN_WIDTH, dimensions.width) } : {}),
    ...(dimensions?.height !== undefined ? { height: Math.max(48, dimensions.height) } : {}),
    opacity: 0,
    version: element.version + 1,
    versionNonce: randomVersionNonce(),
    updated: Date.now(),
    customData: { ...customData, [RICH_TEXT_KEY]: richPayload(html, block) },
  } as SceneElement
}

function tombstoneElement(element: SceneElement): SceneElement {
  return { ...element, isDeleted: true, version: element.version + 1, versionNonce: randomVersionNonce(), updated: Date.now() } as SceneElement
}

function legacyFont(element: SceneElement): string {
  const fontFamily = Number((element as SceneElement & { fontFamily?: number }).fontFamily)
  const mapping: Record<number, string> = {
    1: 'Excalifont, cursive',
    2: 'Helvetica, Arial, sans-serif',
    3: 'Consolas, "Courier New", monospace',
    4: 'Arial, sans-serif',
    5: 'Excalifont, cursive',
    6: 'Nunito, Arial, sans-serif',
    7: '"Lilita One", Arial, sans-serif',
    8: '"Comic Shanns", monospace',
  }
  return mapping[fontFamily] ?? RICH_TEXT_FONTS[0].value
}

function legacyTextToRich(element: SceneElement): SceneElement {
  const legacy = element as SceneElement & { text?: string; fontSize?: number; strokeColor?: string; textAlign?: RichTextAlign }
  const family = legacyFont(element)
  const size = cleanFontSize(Number(legacy.fontSize) || DEFAULT_FONT_SIZE)
  const color = safeColor(String(legacy.strokeColor ?? '')) ?? '#111827'
  const style = `font-family:${escapeHtml(family)};font-size:${size}px;color:${escapeHtml(color)}`
  const html = (legacy.text ?? '').replace(/\u200b/g, '').split(/\r?\n/).map(line => `<p><span style="${style}">${line ? escapeHtml(line) : '<br>'}</span></p>`).join('')
  return createRichTextElement({
    x: element.x,
    y: element.y,
    width: Math.max(MIN_WIDTH, element.width),
    height: Math.max(48, element.height),
    angle: element.angle,
    html,
    block: { textAlign: cleanEnum(legacy.textAlign, ['left', 'center', 'right', 'justify'] as const, 'left') },
  })
}

type SelectionBookmark = { start: number; end: number }

function selectionInside(editor: HTMLElement, range: Range | null): range is Range {
  if (!range) return false
  const node = range.commonAncestorContainer
  return node === editor || editor.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node)
}

function logicalTextLength(value: string): number {
  return value.replace(/\u200b/g, '').length
}

function selectionBookmark(editor: HTMLElement, range: Range): SelectionBookmark {
  const prefix = document.createRange()
  prefix.selectNodeContents(editor)
  prefix.setEnd(range.startContainer, range.startOffset)
  const suffix = document.createRange()
  suffix.selectNodeContents(editor)
  suffix.setEnd(range.endContainer, range.endOffset)
  return {
    start: logicalTextLength(prefix.toString()),
    end: logicalTextLength(suffix.toString()),
  }
}

function rawOffsetForLogical(value: string, logicalOffset: number): number {
  if (logicalOffset <= 0) return 0
  let logical = 0
  for (let raw = 0; raw < value.length; raw++) {
    if (value[raw] !== '\u200b') logical++
    if (logical >= logicalOffset) return raw + 1
  }
  return value.length
}

function rangeFromBookmark(editor: HTMLElement, bookmark: SelectionBookmark): Range {
  const range = document.createRange()
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let total = 0
  let startSet = false
  let endSet = false

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const value = node.data
    const length = logicalTextLength(value)
    const nextTotal = total + length

    if (!startSet && bookmark.start <= nextTotal) {
      range.setStart(node, rawOffsetForLogical(value, Math.max(0, bookmark.start - total)))
      startSet = true
    }
    if (!endSet && bookmark.end <= nextTotal) {
      range.setEnd(node, rawOffsetForLogical(value, Math.max(0, bookmark.end - total)))
      endSet = true
      break
    }
    total = nextTotal
  }

  if (!startSet || !endSet) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  return range
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

function blockStyle(block: RichTextBlockStyle): CSSProperties {
  return {
    backgroundColor: block.backgroundColor,
    padding: block.padding,
    opacity: block.opacity,
    borderRadius: block.borderRadius,
    textAlign: block.textAlign,
    lineHeight: block.lineHeight,
    letterSpacing: `${block.letterSpacing}px`,
    '--rich-paragraph-spacing': `${block.paragraphSpacing}px`,
    justifyContent: block.verticalAlign === 'middle' ? 'center' : block.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
  } as CSSProperties
}

function loadRecentFormatting(): RecentFormatting {
  const fallback: RecentFormatting = { fonts: [], sizes: [], colors: [], highlights: [] }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(RECENT_FORMATTING_KEY)
    if (!raw) return fallback
    const value = JSON.parse(raw) as Partial<RecentFormatting>
    return {
      fonts: Array.isArray(value.fonts) ? value.fonts.filter(item => typeof item === 'string' && resolveFont(item)).slice(0, MAX_RECENT) : [],
      sizes: Array.isArray(value.sizes) ? value.sizes.map(Number).filter(Number.isFinite).map(cleanFontSize).slice(0, MAX_RECENT) : [],
      colors: Array.isArray(value.colors) ? value.colors.filter(item => typeof item === 'string' && safeColor(item)).slice(0, MAX_RECENT) : [],
      highlights: Array.isArray(value.highlights) ? value.highlights.filter(item => typeof item === 'string' && safeColor(item)).slice(0, MAX_RECENT) : [],
    }
  } catch { return fallback }
}

function uniqueRecent<T>(value: T, current: T[]): T[] {
  return [value, ...current.filter(item => item !== value)].slice(0, MAX_RECENT)
}

function saveRecentFormatting(value: RecentFormatting) {
  try { localStorage.setItem(RECENT_FORMATTING_KEY, JSON.stringify(value)) } catch { /* Browser storage is optional. */ }
}

function computedInlineFormat(editor: HTMLElement, range: Range | null): InlineFormat {
  if (!selectionInside(editor, range)) return {}
  let node: Node | null = range.startContainer
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode
  if (!(node instanceof Element)) return {}
  const style = getComputedStyle(node)
  return {
    fontFamily: fontFamilyFromStyle(style.fontFamily) ?? undefined,
    fontSize: `${cleanFontSize(Number.parseFloat(style.fontSize))}px`,
    color: safeColor(style.color) ?? undefined,
    backgroundColor: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : safeColor(style.backgroundColor) ?? undefined,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecorationLine: style.textDecorationLine,
    verticalAlign: style.verticalAlign,
  }
}

export const RichTextLayer = forwardRef<RichTextLayerHandle, {
  api: ExcalidrawImperativeAPI | null
  disabled: boolean
  onEditStart?: () => void
  onEditEnd?: () => void
  onDraft?: (element: SceneElement) => void
}>(function RichTextLayer({ api, disabled, onEditStart, onEditEnd, onDraft }, ref) {
  const [snapshot, setSnapshot] = useState<RichTextSnapshot>({ elements: [], selectedIds: {}, selectedLegacyText: null, scrollX: 0, scrollY: 0, zoom: 1 })
  const snapshotRef = useRef(snapshot)
  const pendingSnapshotRef = useRef<RichTextSnapshot | null>(null)
  const syncFrameRef = useRef<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const selectionRef = useRef<SelectionBookmark | null>(null)
  const draftElementRef = useRef<SceneElement | null>(null)
  const [fontQuery, setFontQuery] = useState<string>(RICH_TEXT_FONTS[0].label)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [textColor, setTextColor] = useState('#111827')
  const [highlightColor, setHighlightColor] = useState('#fff3bf')
  const [linkUrl, setLinkUrl] = useState('https://')
  const [formatPainter, setFormatPainter] = useState<InlineFormat | null>(null)
  const [recentFormatting, setRecentFormatting] = useState<RecentFormatting>(() => loadRecentFormatting())

  useEffect(() => {
    snapshotRef.current = snapshot
    const selectedRich = snapshot.elements.find(element => snapshot.selectedIds[element.id])
    if (selectedRich || snapshot.selectedLegacyText) document.documentElement.dataset.canvasRichTextSelected = 'true'
    else delete document.documentElement.dataset.canvasRichTextSelected
    return () => { delete document.documentElement.dataset.canvasRichTextSelected }
  }, [snapshot])

  useEffect(() => () => {
    if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current)
  }, [])

  const sync = (elements: readonly SceneElement[], appState: AppState) => {
    const richElements = elements.filter(isRichTextElement)
    const selectedLegacyText = elements.find(element => appState.selectedElementIds[element.id] && isLegacyTextElement(element)) ?? null
    if (richElements.length === 0 && snapshotRef.current.elements.length === 0 && !selectedLegacyText && !snapshotRef.current.selectedLegacyText) return
    pendingSnapshotRef.current = {
      elements: richElements,
      selectedIds: { ...appState.selectedElementIds },
      selectedLegacyText,
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

  const beginEditing = (elementId: string) => {
    if (disabled) return
    const element = snapshotRef.current.elements.find(item => item.id === elementId)
      ?? api?.getSceneElementsIncludingDeleted().find(item => item.id === elementId)
    if (!element || !isRichTextElement(element)) return
    draftElementRef.current = element
    onEditStart?.()
    api?.updateScene({ appState: { selectedElementIds: { [elementId]: true } } })
    if (api) {
      const appState = api.getAppState()
      const immediate: RichTextSnapshot = {
        elements: api.getSceneElementsIncludingDeleted().filter(isRichTextElement),
        selectedIds: { [elementId]: true },
        selectedLegacyText: null,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      }
      snapshotRef.current = immediate
      setSnapshot(immediate)
    }
    setEditingId(elementId)
  }

  useLayoutEffect(() => {
    if (!editingId) return
    const editor = editorRef.current
    const current = draftElementRef.current?.id === editingId
      ? draftElementRef.current
      : snapshotRef.current.elements.find(element => element.id === editingId)
    const data = current ? richData(current) : null
    if (!editor || !data) return

    editor.innerHTML = sanitizeRichTextHtml(data.html)
    editor.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = selectionBookmark(editor, range)
  }, [editingId])

  const selectedRich = useMemo(() => snapshot.elements.find(element => snapshot.selectedIds[element.id]) ?? null, [snapshot])
  const selectedData = selectedRich ? richData(selectedRich) : null

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
    if (!current) {
      draftElementRef.current = null
      setEditingId(null)
      queueMicrotask(() => onEditEnd?.())
    }
  }, [editingId, onEditEnd, snapshot.elements])

  const updateSceneElement = (next: SceneElement, captureUpdate = CaptureUpdateAction.IMMEDIATELY) => {
    if (!api) return
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map(element => element.id === next.id ? next : element),
      captureUpdate,
    })
  }

  const dimensionsFor = (current: SceneElement, data: RichTextData, editor: HTMLElement | null) => {
    if (!editor) return { width: current.width, height: current.height }
    const width = data.block.widthMode === 'auto'
      ? clamp(editor.scrollWidth + data.block.padding * 2 + 2, MIN_WIDTH, MAX_AUTO_WIDTH)
      : current.width
    return { width, height: Math.max(current.height, editor.scrollHeight + data.block.padding * 2 + 2, 48) }
  }

  const captureDraft = () => {
    if (!editingId || !api) return
    rememberSelection()
    const editor = editorRef.current
    const apiElement = api.getSceneElementsIncludingDeleted().find(element => element.id === editingId)
    const current = draftElementRef.current?.id === editingId ? draftElementRef.current : apiElement
    if (!editor || !current || !isRichTextElement(current)) return
    const data = richData(current)
    if (!data) return
    const next = updateRichTextElement(current, editor.innerHTML, data.block, dimensionsFor(current, data, editor))
    draftElementRef.current = next
    onDraft?.(next)
  }

  const commit = () => {
    if (!editingId || !api) return
    const editor = editorRef.current
    const apiElement = api.getSceneElementsIncludingDeleted().find(element => element.id === editingId)
    const current = draftElementRef.current?.id === editingId ? draftElementRef.current : apiElement
    if (!editor || !current || !isRichTextElement(current)) return
    const data = richData(current)
    if (!data) return
    const next = updateRichTextElement(current, editor.innerHTML, data.block, dimensionsFor(current, data, editor))
    draftElementRef.current = next
    updateSceneElement(next)
  }

  const finishEditing = () => {
    commit()
    setEditingId(null)
    selectionRef.current = null
    draftElementRef.current = null
    api?.setActiveTool({ type: 'selection' })
    queueMicrotask(() => onEditEnd?.())
  }

  const restoreSelection = (): Range | null => {
    const editor = editorRef.current
    if (!editor) return null
    editor.focus({ preventScroll: true })
    const selection = window.getSelection()
    const saved = selectionRef.current
    const range = saved ? rangeFromBookmark(editor, saved) : document.createRange()
    if (!saved) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = selectionBookmark(editor, range)
    return range
  }

  const rememberSelection = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (!selectionInside(editor, range)) return
    selectionRef.current = selectionBookmark(editor, range)
    const format = computedInlineFormat(editor, range)
    if (format.fontFamily) setFontQuery(fontLabel(format.fontFamily))
    if (format.fontSize) setFontSize(cleanFontSize(Number.parseFloat(format.fontSize)))
    if (format.color) setTextColor(format.color)
    if (format.backgroundColor && format.backgroundColor !== 'transparent') setHighlightColor(format.backgroundColor)
  }

  const recordRecent = (patch: Partial<RecentFormatting>) => {
    setRecentFormatting(current => {
      const next = { ...current, ...patch }
      saveRecentFormatting(next)
      return next
    })
  }

  const applyCommand = (command: string) => {
    if (!editingId) return
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(command, false)
    rememberSelection()
    queueMicrotask(captureDraft)
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
      selectionRef.current = selectionBookmark(editor, nextRange)
    } else {
      const fragment = range.extractContents()
      span.append(fragment)
      range.insertNode(span)
      const nextRange = document.createRange()
      nextRange.selectNodeContents(span)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(nextRange)
      selectionRef.current = selectionBookmark(editor, nextRange)
    }
    editor.focus({ preventScroll: true })
    queueMicrotask(captureDraft)
  }

  const applyFont = (value: string) => {
    const resolved = resolveFont(value)
    if (!resolved) return
    setFontQuery(fontLabel(resolved))
    recordRecent({ fonts: uniqueRecent(resolved, recentFormatting.fonts) })
    applyInlineStyle({ fontFamily: resolved })
  }
  const applySize = (value: number) => {
    const next = cleanFontSize(value)
    setFontSize(next)
    recordRecent({ sizes: uniqueRecent(next, recentFormatting.sizes) })
    applyInlineStyle({ fontSize: `${next}px` })
  }
  const applyTextColor = (value: string) => {
    const color = safeColor(value)
    if (!color) return
    setTextColor(color)
    recordRecent({ colors: uniqueRecent(color, recentFormatting.colors) })
    applyInlineStyle({ color })
  }
  const applyHighlight = (value: string) => {
    const color = safeColor(value)
    if (!color) return
    setHighlightColor(color)
    recordRecent({ highlights: uniqueRecent(color, recentFormatting.highlights) })
    applyInlineStyle({ backgroundColor: color })
  }

  const copyFormat = () => {
    const editor = editorRef.current
    const range = restoreSelection()
    if (!editor || !range) return
    setFormatPainter(computedInlineFormat(editor, range))
    rememberSelection()
  }

  const pasteFormat = () => {
    if (formatPainter) applyInlineStyle(formatPainter as Partial<CSSStyleDeclaration>)
  }

  const applyLink = () => {
    if (!editingId) return
    const href = safeHref(linkUrl)
    if (!href) return
    const editor = editorRef.current
    const range = restoreSelection()
    if (!editor || !range) return
    if (range.collapsed) {
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer nofollow'
      anchor.textContent = href.replace(/^https?:\/\//, '')
      range.insertNode(anchor)
      const nextRange = document.createRange()
      nextRange.setStartAfter(anchor)
      nextRange.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(nextRange)
      selectionRef.current = selectionBookmark(editor, nextRange)
    } else {
      document.execCommand('createLink', false, href)
      for (const anchor of Array.from(editor.querySelectorAll('a'))) {
        const safe = safeHref(anchor.getAttribute('href') ?? '')
        if (!safe) anchor.replaceWith(...Array.from(anchor.childNodes))
        else {
          anchor.href = safe
          anchor.target = '_blank'
          anchor.rel = 'noopener noreferrer nofollow'
        }
      }
      rememberSelection()
    }
    queueMicrotask(captureDraft)
  }

  const updateBlockStyle = (patch: Partial<RichTextBlockStyle>) => {
    if (!selectedRich || !api) return
    const apiElement = api.getSceneElementsIncludingDeleted().find(element => element.id === selectedRich.id)
    const current = editingId === selectedRich.id && draftElementRef.current?.id === selectedRich.id ? draftElementRef.current : apiElement
    if (!current || !isRichTextElement(current)) return
    const data = richData(current)
    if (!data) return
    const html = editingId === current.id && editorRef.current ? editorRef.current.innerHTML : data.html
    const block = normalizeBlockStyle({ ...data.block, ...patch })
    rememberSelection()
    const next = updateRichTextElement(current, html, block, dimensionsFor(current, { ...data, block }, editingId === current.id ? editorRef.current : null))
    if (editingId === current.id) {
      draftElementRef.current = next
      onDraft?.(next)
    }
    updateSceneElement(next, editingId === current.id ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY)
    if (editingId === current.id) requestAnimationFrame(() => { restoreSelection() })
  }

  const convertLegacyText = () => {
    const legacy = snapshot.selectedLegacyText
    if (!legacy || !api || disabled) return
    const converted = legacyTextToRich(legacy)
    const tombstone = tombstoneElement(legacy)
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map(element => element.id === legacy.id ? tombstone : element).concat(converted),
      appState: { selectedElementIds: { [converted.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    requestAnimationFrame(() => beginEditing(converted.id))
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rich = event.clipboardData.getData('text/html')
    const plain = event.clipboardData.getData('text/plain')
    const html = rich ? sanitizeRichTextHtml(rich) : plainTextToRichHtml(plain)
    restoreSelection()
    document.execCommand('insertHTML', false, html)
    rememberSelection()
    queueMicrotask(captureDraft)
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
    const key = event.key.toLowerCase()
    if (key === 'b') { event.preventDefault(); applyCommand('bold'); return }
    if (key === 'i') { event.preventDefault(); applyCommand('italic'); return }
    if (key === 'u') { event.preventDefault(); applyCommand('underline'); return }
    if (key === 'z' && event.shiftKey) { event.preventDefault(); document.execCommand('redo'); return }
    if (key === 'z') { event.preventDefault(); document.execCommand('undo'); return }
    if (key === 'y') { event.preventDefault(); document.execCommand('redo') }
  }

  const handleEditorBlur = (_event: FocusEvent<HTMLDivElement>) => {
    window.setTimeout(() => {
      const active = document.activeElement
      if (toolbarRef.current?.contains(active) || editorRef.current?.contains(active)) return
      finishEditing()
    }, 0)
  }

  const handleEditorFocus = () => {
    const saved = selectionRef.current
    if (!saved) return
    queueMicrotask(() => {
      const editor = editorRef.current
      if (!editor || document.activeElement !== editor) return
      const range = rangeFromBookmark(editor, saved)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const handleEditorClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLAnchorElement)) return
    event.preventDefault()
    if (!(event.metaKey || event.ctrlKey)) return
    const href = safeHref(target.href)
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }

  const mergedTextColors = [...new Set([...recentFormatting.colors, ...TEXT_COLORS])]
  const mergedHighlights = [...new Set([...recentFormatting.highlights, ...HIGHLIGHT_COLORS])]
  const block = selectedData?.block ?? DEFAULT_BLOCK_STYLE
  const setWidthMode = (value: string) => updateBlockStyle({ widthMode: value === 'auto' ? 'auto' : 'fixed' })
  const setVerticalAlign = (value: string) => updateBlockStyle({ verticalAlign: value === 'middle' ? 'middle' : value === 'bottom' ? 'bottom' : 'top' })
  const setBlockNumber = (key: 'lineHeight' | 'letterSpacing' | 'paragraphSpacing' | 'padding' | 'borderRadius', value: string) => {
    updateBlockStyle({ [key]: Number(value) } as Partial<RichTextBlockStyle>)
  }
  const setBlockOpacity = (value: string) => updateBlockStyle({ opacity: Number(value) / 100 })

  return <>
    <div className="rich-text-layer" aria-label="Rich text layer">
      {snapshot.elements.map(element => {
        const data = richData(element)
        if (!data) return null
        const editing = editingId === element.id
        const draft = editing && draftElementRef.current?.id === element.id ? draftElementRef.current : element
        const draftData = richData(draft) ?? data
        const html = sanitizeRichTextHtml(draftData.html)
        return <div key={element.id} className={`rich-text-block${editing ? ' is-editing' : ''}`} style={positionStyle(draft, snapshot)} data-rich-text-id={element.id} data-width-mode={draftData.block.widthMode}>
          <div className="rich-text-content" style={blockStyle(draftData.block)}>
            {editing
              ? <div
                  key="editor"
                  ref={editorRef}
                  className="rich-text-body rich-text-editor"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  onInput={captureDraft}
                  onPaste={handlePaste}
                  onDrop={event => event.preventDefault()}
                  onKeyDown={handleKeyDown}
                  onKeyUp={rememberSelection}
                  onPointerUp={rememberSelection}
                  onBlur={handleEditorBlur}
                  onFocus={handleEditorFocus}
                  onClick={handleEditorClick}
                />
              : <div key="display" className="rich-text-body" dangerouslySetInnerHTML={{ __html: html }} />}
          </div>
        </div>
      })}
    </div>

    {snapshot.selectedLegacyText && !selectedRich && <div ref={toolbarRef} className="rich-text-toolbar rich-text-convert-toolbar" role="toolbar" aria-label="Legacy text conversion">
      <span>This is legacy text.</span>
      <button type="button" className="rich-text-done-button" disabled={disabled} onClick={convertLegacyText}>Convert to rich text</button>
    </div>}

    {selectedRich && selectedData && <div ref={toolbarRef} className="rich-text-toolbar" role="toolbar" aria-label="Rich text formatting">
      {!editingId && <button type="button" className="rich-text-edit-button" onClick={() => beginEditing(selectedRich.id)}>Edit text</button>}
      <button type="button" aria-label="Bold" title="Bold (Ctrl/⌘ B)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('bold')}><strong>B</strong></button>
      <button type="button" aria-label="Italic" title="Italic (Ctrl/⌘ I)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('italic')}><em>I</em></button>
      <button type="button" aria-label="Underline" title="Underline (Ctrl/⌘ U)" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('underline')}><u>U</u></button>
      <button type="button" aria-label="Strikethrough" title="Strikethrough" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('strikeThrough')}><s>S</s></button>

      <label className="rich-text-control rich-text-font-control">Font
        <input type="text" list="canvas-rich-text-fonts" value={fontQuery} disabled={!editingId} onMouseDown={rememberSelection} onChange={event => setFontQuery(event.target.value)} onBlur={() => applyFont(fontQuery)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyFont(fontQuery) } }} />
        <datalist id="canvas-rich-text-fonts">
          {recentFormatting.fonts.map(font => <option key={`recent-${font}`} value={fontLabel(font)}>Recent</option>)}
          {RICH_TEXT_FONTS.map(font => <option key={font.label} value={font.label} />)}
        </datalist>
      </label>

      <label className="rich-text-control rich-text-size-control">Size
        <input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} list="canvas-rich-text-sizes" value={fontSize} disabled={!editingId} onMouseDown={rememberSelection} onChange={event => setFontSize(cleanFontSize(Number(event.target.value)))} onBlur={() => applySize(fontSize)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applySize(fontSize) } }} />
        <datalist id="canvas-rich-text-sizes">{[...new Set([...recentFormatting.sizes, ...RICH_TEXT_FONT_SIZES])].map(size => <option key={size} value={size} />)}</datalist>
      </label>

      <div className="rich-text-color-group" aria-label="Text colors">
        <span>Text</span>
        {mergedTextColors.slice(0, 10).map(color => <button key={color} type="button" className="rich-text-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Text color ${color}`} disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyTextColor(color)} />)}
        <input type="color" aria-label="Custom text color" value={textColor.startsWith('#') ? textColor : '#111827'} disabled={!editingId} onMouseDown={rememberSelection} onChange={event => applyTextColor(event.target.value)} />
      </div>

      <div className="rich-text-color-group" aria-label="Highlight colors">
        <span>Highlight</span>
        {mergedHighlights.slice(0, 8).map(color => <button key={color} type="button" className="rich-text-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Highlight ${color}`} disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyHighlight(color)} />)}
        <input type="color" aria-label="Custom highlight color" value={highlightColor.startsWith('#') ? highlightColor : '#fff3bf'} disabled={!editingId} onMouseDown={rememberSelection} onChange={event => applyHighlight(event.target.value)} />
        <button type="button" className="rich-text-clear-highlight" title="Remove highlight" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineStyle({ backgroundColor: 'transparent' })}>×</button>
      </div>

      <div className="rich-text-align-group" aria-label="Text alignment">
        {(['left', 'center', 'right', 'justify'] as const).map(alignment => <button key={alignment} type="button" className={block.textAlign === alignment ? 'is-active' : ''} aria-label={`Align ${alignment}`} onClick={() => updateBlockStyle({ textAlign: alignment })}>{alignment === 'left' ? 'L' : alignment === 'center' ? 'C' : alignment === 'right' ? 'R' : 'J'}</button>)}
      </div>

      <details className="rich-text-more">
        <summary>More</summary>
        <div className="rich-text-more-panel">
          <div className="rich-text-section">
            <strong>Paragraph</strong>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('insertUnorderedList')}>• List</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('insertOrderedList')}>1. List</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('outdent')}>Outdent</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('indent')}>Indent</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('subscript')}>x₂</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('superscript')}>x²</button>
          </div>

          <div className="rich-text-section rich-text-layout-controls">
            <strong>Layout</strong>
            <label>Width
              <select value={block.widthMode} onChange={event => setWidthMode(event.currentTarget.value)}>
                <option value="fixed">Fixed</option>
                <option value="auto">Auto</option>
              </select>
            </label>
            <label>Vertical
              <select value={block.verticalAlign} onChange={event => setVerticalAlign(event.currentTarget.value)}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>Line
              <input type="number" min="0.8" max="3" step="0.05" value={block.lineHeight} onChange={event => setBlockNumber('lineHeight', event.currentTarget.value)} />
            </label>
            <label>Tracking
              <input type="number" min="-5" max="20" step="0.1" value={block.letterSpacing} onChange={event => setBlockNumber('letterSpacing', event.currentTarget.value)} />
            </label>
            <label>Paragraph
              <input type="number" min="0" max="64" step="1" value={block.paragraphSpacing} onChange={event => setBlockNumber('paragraphSpacing', event.currentTarget.value)} />
            </label>
            <label>Padding
              <input type="number" min="0" max="64" step="1" value={block.padding} onChange={event => setBlockNumber('padding', event.currentTarget.value)} />
            </label>
            <label>Radius
              <input type="number" min="0" max="48" step="1" value={block.borderRadius} onChange={event => setBlockNumber('borderRadius', event.currentTarget.value)} />
            </label>
            <label>Opacity
              <input type="number" min="10" max="100" step="5" value={Math.round(block.opacity * 100)} onChange={event => setBlockOpacity(event.currentTarget.value)} />
            </label>
          </div>

          <div className="rich-text-section rich-text-background-section">
            <strong>Text block</strong>
            <div className="rich-text-background-swatches">
              {BLOCK_BACKGROUND_COLORS.map(color => <button key={color} type="button" className={`rich-text-swatch${block.backgroundColor === color ? ' is-active' : ''}`} style={{ '--swatch': color === 'transparent' ? '#ffffff' : color } as CSSProperties} aria-label={color === 'transparent' ? 'Transparent background' : `Background ${color}`} onClick={() => updateBlockStyle({ backgroundColor: color })} />)}
              <input type="color" aria-label="Custom block background" value={block.backgroundColor.startsWith('#') ? block.backgroundColor : '#ffffff'} onChange={event => updateBlockStyle({ backgroundColor: event.target.value })} />
            </div>
            <button type="button" onClick={() => updateBlockStyle({ backgroundColor: '#fff9db', padding: 12, borderRadius: 10 })}>Callout</button>
            <button type="button" onClick={() => updateBlockStyle({ backgroundColor: 'transparent', padding: DEFAULT_BLOCK_STYLE.padding, borderRadius: 0, opacity: 1 })}>Plain</button>
          </div>

          <div className="rich-text-section rich-text-link-section">
            <strong>Link</strong>
            <input type="url" value={linkUrl} disabled={!editingId} onMouseDown={rememberSelection} onChange={event => setLinkUrl(event.target.value)} placeholder="https://…" />
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={applyLink}>Apply link</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('unlink')}>Unlink</button>
          </div>

          <div className="rich-text-section">
            <strong>Formatting</strong>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={copyFormat}>Copy style</button>
            <button type="button" disabled={!editingId || !formatPainter} onMouseDown={event => event.preventDefault()} onClick={pasteFormat}>Paste style</button>
            <button type="button" disabled={!editingId} onMouseDown={event => event.preventDefault()} onClick={() => applyCommand('removeFormat')}>Clear inline formatting</button>
          </div>
        </div>
      </details>

      {editingId && <button type="button" className="rich-text-done-button" onMouseDown={event => event.preventDefault()} onClick={finishEditing}>Done</button>}
    </div>}
  </>
})
