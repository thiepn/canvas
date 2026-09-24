import type { BinaryFileData, BinaryFiles, DataURL } from '@excalidraw/excalidraw/types'
import type { LiveTableName } from '../config/public-config.ts'

export const CANVAS_ASSET_MAX_BYTES = 12 * 1024 * 1024
export const CANVAS_ASSET_ID = /^[0-9a-f]{64}$/
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

export type ImageElementLike = {
  id: string
  type: string
  fileId?: string | null
  status?: string
  isDeleted?: boolean
}

export function assetBucketForTable(tableName: LiveTableName): 'canvas-assets' | 'canvas-ci-assets' {
  return tableName === 'canvas_ci_elements' ? 'canvas-ci-assets' : 'canvas-assets'
}

export function assetPathForFileId(fileId: string): string {
  if (!CANVAS_ASSET_ID.test(fileId)) throw new Error('Canvas image file ID is invalid.')
  return `sha256/${fileId}`
}

export function isSupportedImageMime(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
}

export function validateImageBlob(blob: Blob): void {
  if (!isSupportedImageMime(blob.type)) throw new Error('Canvas supports PNG, JPEG, WebP, GIF, and SVG images.')
  if (blob.size <= 0) throw new Error('The image file is empty.')
  if (blob.size > CANVAS_ASSET_MAX_BYTES) throw new Error('Images are limited to 12 MB.')
}

export async function validateImageContent(blob: Blob): Promise<void> {
  validateImageBlob(blob)
  if (blob.type.toLowerCase() !== 'image/svg+xml') return
  const svg = await blob.text()
  if (!/<svg(?:\s|>)/i.test(svg)) throw new Error('SVG import does not contain an SVG root element.')
  if (/<(?:script|foreignObject|iframe|object|embed)(?:\s|>)/i.test(svg)
    || /\son[a-z]+\s*=/i.test(svg)
    || /(?:href|xlink:href)\s*=\s*["']\s*(?:javascript:|https?:|\/\/)/i.test(svg)
    || /(?:@import|url\(\s*["']?\s*(?:https?:|\/\/|javascript:))/i.test(svg)
    || /<!DOCTYPE|<!ENTITY/i.test(svg)) {
    throw new Error('SVG contains active or external content that Canvas does not allow.')
  }
}

export async function sha256BlobId(blob: Blob): Promise<string> {
  await validateImageContent(blob)
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function generateCanvasFileId(file: File): Promise<string> {
  return sha256BlobId(file)
}

export async function dataUrlToBlob(dataURL: string): Promise<Blob> {
  if (!/^data:image\//i.test(dataURL)) throw new Error('Canvas asset is not an image data URL.')
  const response = await fetch(dataURL)
  if (!response.ok) throw new Error('Canvas could not decode the image.')
  const blob = await response.blob()
  validateImageBlob(blob)
  return blob
}

export async function blobToDataUrl(blob: Blob): Promise<DataURL> {
  validateImageBlob(blob)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK)))
  }
  return `data:${blob.type};base64,${btoa(binary)}` as DataURL
}

export function referencedAssetIds(elements: readonly ImageElementLike[]): Set<string> {
  const ids = new Set<string>()
  for (const element of elements) {
    if (element.isDeleted || element.type !== 'image' || !element.fileId || !CANVAS_ASSET_ID.test(element.fileId)) continue
    ids.add(element.fileId)
  }
  return ids
}

export function isPersistableCanvasElement(element: ImageElementLike): boolean {
  if (element.type !== 'image') return true
  return element.status === 'saved' && typeof element.fileId === 'string' && CANVAS_ASSET_ID.test(element.fileId)
}

export function referencedFiles(files: BinaryFiles, elements: readonly ImageElementLike[]): BinaryFiles {
  const wanted = referencedAssetIds(elements)
  return Object.fromEntries(
    Object.entries(files).filter(([id, file]) => wanted.has(id) && CANVAS_ASSET_ID.test(id) && isSupportedImageMime(file.mimeType)),
  ) as BinaryFiles
}

export function binaryFileFromBlob(fileId: string, blob: Blob, created = Date.now()): Promise<BinaryFileData> {
  if (!CANVAS_ASSET_ID.test(fileId)) return Promise.reject(new Error('Canvas image file ID is invalid.'))
  return blobToDataUrl(blob).then(dataURL => ({
    id: fileId as BinaryFileData['id'],
    mimeType: blob.type as BinaryFileData['mimeType'],
    dataURL,
    created,
    lastRetrieved: Date.now(),
  }))
}

export function isDuplicateStorageError(error: { message?: string; statusCode?: string | number; status?: number } | null | undefined): boolean {
  if (!error) return false
  const status = Number(error.statusCode ?? error.status)
  return status === 409 || /duplicate|already exists|resource already exists/i.test(error.message ?? '')
}
