import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANVAS_ASSET_ID,
  CANVAS_ASSET_MAX_BYTES,
  assetBucketForTable,
  assetPathForFileId,
  dataUrlToBlob,
  generateCanvasFileId,
  isDuplicateStorageError,
  isPersistableCanvasElement,
  isSafeCanvasLink,
  referencedAssetIds,
  sha256BlobId,
  validateImageBlob,
  validateImageContent,
} from '../../app/canvas/media-assets.ts'

test('content-addressed image IDs are deterministic SHA-256 values', async () => {
  const pngPrefix = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const first = new File([new Uint8Array([...pngPrefix, 1, 2, 3, 4])], 'a.png', { type: 'image/png' })
  const second = new File([new Uint8Array([...pngPrefix, 1, 2, 3, 4])], 'b.png', { type: 'image/png' })
  const changed = new File([new Uint8Array([...pngPrefix, 1, 2, 3, 5])], 'c.png', { type: 'image/png' })
  const firstId = await generateCanvasFileId(first)
  assert.match(firstId, CANVAS_ASSET_ID)
  assert.equal(firstId, await generateCanvasFileId(second))
  assert.notEqual(firstId, await generateCanvasFileId(changed))
  assert.equal(firstId, await sha256BlobId(first))
})

test('bucket and object paths stay isolated between production and CI', () => {
  assert.equal(assetBucketForTable('canvas_elements'), 'canvas-assets')
  assert.equal(assetBucketForTable('canvas_ci_elements'), 'canvas-ci-assets')
  const id = 'a'.repeat(64)
  assert.equal(assetPathForFileId(id), `sha256/${id}`)
  assert.throws(() => assetPathForFileId('../bad'), /invalid/i)
})

test('image validation enforces MIME allowlist and 12 MB ceiling', () => {
  validateImageBlob(new Blob([new Uint8Array([1])], { type: 'image/webp' }))
  assert.throws(() => validateImageBlob(new Blob([new Uint8Array([1])], { type: 'text/html' })), /supports PNG/i)
  assert.throws(() => validateImageBlob(new Blob([], { type: 'image/png' })), /empty/i)
  assert.throws(() => validateImageBlob(new Blob([new Uint8Array(CANVAS_ASSET_MAX_BYTES + 1)], { type: 'image/png' })), /12 MB/i)
})

test('image data URLs decode through the same validation contract', async () => {
  const blob = await dataUrlToBlob('data:image/png;base64,AQID')
  assert.equal(blob.type, 'image/png')
  assert.equal(blob.size, 3)
  await assert.rejects(() => dataUrlToBlob('data:text/html;base64,PGgxPg=='), /not an image/i)
})

test('only saved content-addressed images are persistable', () => {
  const id = 'b'.repeat(64)
  assert.equal(isPersistableCanvasElement({ id: 'x', type: 'rectangle' }), true)
  assert.equal(isPersistableCanvasElement({ id: 'x', type: 'image', fileId: id, status: 'saved' }), true)
  assert.equal(isPersistableCanvasElement({ id: 'x', type: 'image', fileId: id, status: 'pending' }), false)
  assert.equal(isPersistableCanvasElement({ id: 'x', type: 'image', fileId: 'bad', status: 'saved' }), false)
})

test('referenced assets ignore tombstones and malformed IDs', () => {
  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)
  assert.deepEqual(
    [...referencedAssetIds([
      { id: '1', type: 'image', fileId: a, status: 'saved' },
      { id: '2', type: 'image', fileId: b, status: 'saved', isDeleted: true },
      { id: '3', type: 'image', fileId: 'bad', status: 'saved' },
      { id: '4', type: 'rectangle' },
    ])],
    [a],
  )
})

test('duplicate Storage conflicts are treated as successful immutable deduplication', () => {
  assert.equal(isDuplicateStorageError({ statusCode: 409, message: 'Conflict' }), true)
  assert.equal(isDuplicateStorageError({ statusCode: '400', message: 'The resource already exists' }), true)
  assert.equal(isDuplicateStorageError({ statusCode: 500, message: 'Server failure' }), false)
})


test('SVG validation allows static artwork and rejects active or externally loaded content', async () => {
  await validateImageContent(new Blob([
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
  ], { type: 'image/svg+xml' }))

  for (const unsafe of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/tracker.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "https://example.com/x">]><svg xmlns="http://www.w3.org/2000/svg"/>',
  ]) {
    await assert.rejects(
      () => validateImageContent(new Blob([unsafe], { type: 'image/svg+xml' })),
      /active or external content/i,
    )
  }
})


test('raster validation rejects MIME-spoofed bytes and accepts supported signatures', async () => {
  await validateImageContent(new Blob([
    new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]),
  ], { type: 'image/png' }))
  await validateImageContent(new Blob([
    new Uint8Array([0xff,0xd8,0xff,0xe0,0,0,0,0]),
  ], { type: 'image/jpeg' }))
  await validateImageContent(new Blob(['GIF89a123456'], { type: 'image/gif' }))
  await validateImageContent(new Blob(['RIFF1234WEBPxxxx'], { type: 'image/webp' }))

  await assert.rejects(
    () => validateImageContent(new Blob(['<html>not png</html>'], { type: 'image/png' })),
    /bytes do not match/i,
  )
})


test('Canvas links allow only HTTP(S), internal anchors, or empty values', () => {
  assert.equal(isSafeCanvasLink(null), true)
  assert.equal(isSafeCanvasLink(''), true)
  assert.equal(isSafeCanvasLink('https://example.com/path'), true)
  assert.equal(isSafeCanvasLink('HTTP://example.com'), true)
  assert.equal(isSafeCanvasLink('#element=abc'), true)
  assert.equal(isSafeCanvasLink('javascript:alert(1)'), false)
  assert.equal(isSafeCanvasLink('data:text/html,unsafe'), false)
  assert.equal(isSafeCanvasLink('mailto:test@example.com'), false)
  assert.equal(isSafeCanvasLink('x'.repeat(4097)), false)
})
