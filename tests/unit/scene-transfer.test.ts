import assert from 'node:assert/strict'
import test from 'node:test'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import { CANVAS_IMPORT_MAX_ELEMENTS, CANVAS_IMPORT_MAX_FILES, createCanvasBackup, createCanvasClipboard, jpegBytesToPdf, parseCanvasImport } from '../../app/canvas/scene-transfer.ts'

const fileId = 'c'.repeat(64)
const unusedId = 'd'.repeat(64)
const files = {
  [fileId]: { id: fileId, mimeType: 'image/png', dataURL: 'data:image/png;base64,AQID', created: 1 },
  [unusedId]: { id: unusedId, mimeType: 'image/png', dataURL: 'data:image/png;base64,BAUG', created: 2 },
} as unknown as BinaryFiles

test('Canvas backup v3 includes only image files referenced by active elements', () => {
  const backup = createCanvasBackup([
    { id: 'image-a', type: 'image', fileId, status: 'saved' },
    { id: 'shape-a', type: 'rectangle' },
  ], files, '2026-09-24T00:00:00.000Z')
  assert.equal(backup.version, 3)
  assert.equal(backup.exportedAt, '2026-09-24T00:00:00.000Z')
  assert.deepEqual(Object.keys(backup.files), [fileId])
})

test('Canvas v2, v3 and native Excalidraw JSON imports are accepted', () => {
  assert.deepEqual(parseCanvasImport(JSON.stringify({
    type: 'canvas-backup', version: 2, elements: [{ id: 'a' }],
  })), { elements: [{ id: 'a' }], files: {} })

  const v3 = parseCanvasImport(JSON.stringify({
    type: 'canvas-backup', version: 3, elements: [{ id: 'b' }], files,
  }))
  assert.equal(v3.elements.length, 1)
  assert.equal(Object.keys(v3.files).length, 2)

  const native = parseCanvasImport(JSON.stringify({
    type: 'excalidraw', version: 2, elements: [{ id: 'c' }], files,
  }))
  assert.equal(native.elements.length, 1)
  assert.equal(Object.keys(native.files).length, 2)
})

test('scene import rejects unrelated and malformed JSON', () => {
  assert.throws(() => parseCanvasImport('{'), /not valid/i)
  assert.throws(() => parseCanvasImport(JSON.stringify({ type: 'other', elements: [] })), /neither/i)
  assert.throws(() => parseCanvasImport(JSON.stringify({ type: 'canvas-backup', version: 99, elements: [] })), /not supported/i)
  assert.throws(() => parseCanvasImport(JSON.stringify({ type: 'canvas-backup', version: 3 })), /elements array/i)
})

test('JPEG bytes are wrapped into a structurally complete one-page PDF', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const pdf = jpegBytesToPdf(jpeg, 800, 600)
  assert.equal(pdf.type, 'application/pdf')
  const bytes = new Uint8Array(await pdf.arrayBuffer())
  const head = new TextDecoder().decode(bytes.slice(0, 8))
  const tail = new TextDecoder().decode(bytes.slice(-16))
  assert.match(head, /^%PDF-1\.4/)
  assert.match(tail, /%%EOF/)
  assert.ok(bytes.length > jpeg.length)
})


test('portable Canvas clipboard reuses the same bounded scene/file import contract', () => {
  const clipboard = createCanvasClipboard([
    { id: 'image-a', type: 'image', fileId, status: 'saved' },
    { id: 'shape-a', type: 'rectangle' },
  ], files)
  assert.equal(clipboard.type, 'canvas-clipboard')
  assert.equal(clipboard.version, 1)
  assert.deepEqual(Object.keys(clipboard.files), [fileId])

  const parsed = parseCanvasImport(JSON.stringify(clipboard))
  assert.equal(parsed.elements.length, 2)
  assert.deepEqual(Object.keys(parsed.files), [fileId])
})


test('scene import enforces element and file-count denial-of-service limits', () => {
  const tooManyElements = Array.from({ length: CANVAS_IMPORT_MAX_ELEMENTS + 1 }, (_, index) => ({ id: String(index) }))
  assert.throws(
    () => parseCanvasImport(JSON.stringify({ type: 'canvas-backup', version: 3, elements: tooManyElements, files: {} })),
    /more than .* elements/i,
  )

  const tooManyFiles = Object.fromEntries(
    Array.from({ length: CANVAS_IMPORT_MAX_FILES + 1 }, (_, index) => [String(index), { id: String(index) }]),
  )
  assert.throws(
    () => parseCanvasImport(JSON.stringify({ type: 'canvas-backup', version: 3, elements: [], files: tooManyFiles })),
    /more than .* files/i,
  )
})
