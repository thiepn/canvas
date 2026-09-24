import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import { referencedFiles, type ImageElementLike } from './media-assets.ts'

export const CANVAS_IMPORT_MAX_BYTES = 80 * 1024 * 1024
export const CANVAS_IMPORT_MAX_ELEMENTS = 20_000
export const CANVAS_IMPORT_MAX_FILES = 500

export type CanvasBackupV3 = {
  type: 'canvas-backup'
  version: 3
  engine: 'excalidraw'
  exportedAt: string
  elements: unknown[]
  files: BinaryFiles
}

export type CanvasClipboardV1 = {
  type: 'canvas-clipboard'
  version: 1
  engine: 'excalidraw'
  elements: unknown[]
  files: BinaryFiles
}

export type ImportedCanvasData = {
  elements: unknown[]
  files: BinaryFiles
}

export function createCanvasBackup(elements: readonly ImageElementLike[], files: BinaryFiles, exportedAt = new Date().toISOString()): CanvasBackupV3 {
  return {
    type: 'canvas-backup',
    version: 3,
    engine: 'excalidraw',
    exportedAt,
    elements: [...elements],
    files: referencedFiles(files, elements),
  }
}

export function createCanvasClipboard(elements: readonly ImageElementLike[], files: BinaryFiles): CanvasClipboardV1 {
  return {
    type: 'canvas-clipboard',
    version: 1,
    engine: 'excalidraw',
    elements: [...elements],
    files: referencedFiles(files, elements),
  }
}

function objectFiles(value: unknown): BinaryFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > CANVAS_IMPORT_MAX_FILES) throw new Error(`Canvas import contains more than ${CANVAS_IMPORT_MAX_FILES} files.`)
  return Object.fromEntries(entries) as BinaryFiles
}

export function parseCanvasImport(text: string): ImportedCanvasData {
  if (new TextEncoder().encode(text).length > CANVAS_IMPORT_MAX_BYTES) throw new Error('Canvas import is too large.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid Canvas or Excalidraw JSON.')
  }
  if (!value || typeof value !== 'object') throw new Error('Canvas import must be a JSON object.')
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.elements)) throw new Error('Canvas import does not contain an elements array.')
  if (raw.elements.length > CANVAS_IMPORT_MAX_ELEMENTS) throw new Error(`Canvas import contains more than ${CANVAS_IMPORT_MAX_ELEMENTS} elements.`)

  if (raw.type === 'canvas-backup') {
    const version = Number(raw.version)
    if (version !== 2 && version !== 3) throw new Error('This Canvas backup version is not supported.')
    return { elements: raw.elements, files: version >= 3 ? objectFiles(raw.files) : {} }
  }

  if (raw.type === 'excalidraw') {
    return { elements: raw.elements, files: objectFiles(raw.files) }
  }

  if (raw.type === 'canvas-clipboard') {
    if (Number(raw.version) !== 1) throw new Error('This Canvas clipboard version is not supported.')
    return { elements: raw.elements, files: objectFiles(raw.files) }
  }

  throw new Error('This JSON file is neither a Canvas backup, Canvas clipboard, nor an Excalidraw scene.')
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function jpegBytesToPdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number): Blob {
  if (!jpeg.length || !Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    throw new Error('Canvas could not create a PDF from the exported image.')
  }

  const pointsPerPixel = 72 / 96
  const maxPagePoints = 14_400
  const naturalWidth = pixelWidth * pointsPerPixel
  const naturalHeight = pixelHeight * pointsPerPixel
  const scale = Math.min(1, maxPagePoints / Math.max(naturalWidth, naturalHeight))
  const pageWidth = Math.max(1, naturalWidth * scale)
  const pageHeight = Math.max(1, naturalHeight * scale)
  const content = ascii(`q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`)

  const objects: Uint8Array[] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concat([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${Math.round(pixelWidth)} /Height ${Math.round(pixelHeight)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      ascii('\nendstream'),
    ]),
    concat([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]),
  ]

  const chunks: Uint8Array[] = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]
  const offsets = [0]
  let cursor = chunks[0].length
  objects.forEach((object, index) => {
    offsets.push(cursor)
    const prefix = ascii(`${index + 1} 0 obj\n`)
    const suffix = ascii('\nendobj\n')
    chunks.push(prefix, object, suffix)
    cursor += prefix.length + object.length + suffix.length
  })

  const xrefOffset = cursor
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index++) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(ascii(xref))
  return new Blob(chunks, { type: 'application/pdf' })
}
