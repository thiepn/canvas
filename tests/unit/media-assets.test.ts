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
  referencedAssetIds,
  sha256BlobId,
  validateImageBlob,
} from '../../app/canvas/media-assets.ts'

test('content-addressed image IDs are deterministic SHA-256 values', async () => {
  const first = new File([new Uint8Array([1, 2, 3, 4])], 'a.png', { type: 'image/png' })
  const second = new File([new Uint8Array([1, 2, 3, 4])], 'b.png', { type: 'image/png' })
  const changed = new File([new Uint8Array([1, 2, 3, 5])], 'c.png', { type: 'image/png' })
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
