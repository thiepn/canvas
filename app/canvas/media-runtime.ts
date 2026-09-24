import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  newElementWith,
  restoreElements,
} from '@excalidraw/excalidraw'
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assetPathForFileId,
  binaryFileFromBlob,
  blobToDataUrl,
  dataUrlToBlob,
  generateCanvasFileId,
  isDuplicateStorageError,
  isSupportedImageMime,
  referencedAssetIds,
  sha256BlobId,
} from './media-assets.ts'
import { createCanvasBackup, jpegBytesToPdf, parseCanvasImport } from './scene-transfer.ts'
import type { CanvasExportFormat } from './MediaControls.tsx'

export type MediaSceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number]

export async function uploadCanvasAsset(
  supabase: SupabaseClient,
  bucket: string,
  file: BinaryFileData,
): Promise<void> {
  const blob = await dataUrlToBlob(file.dataURL)
  const hash = await sha256BlobId(blob)
  if (hash !== file.id) throw new Error('Image content does not match its Canvas file ID.')
  const { error } = await supabase.storage.from(bucket).upload(assetPathForFileId(file.id), blob, {
    contentType: file.mimeType,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error && !isDuplicateStorageError(error)) throw error
}

export async function downloadCanvasAsset(
  supabase: SupabaseClient,
  bucket: string,
  fileId: string,
): Promise<BinaryFileData> {
  const { data, error } = await supabase.storage.from(bucket).download(assetPathForFileId(fileId))
  if (error) throw error
  const hash = await sha256BlobId(data)
  if (hash !== fileId) throw new Error('Downloaded image failed its content hash check.')
  return binaryFileFromBlob(fileId, data)
}

function sceneCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const state = api.getAppState()
  const zoom = Math.max(0.01, state.zoom.value)
  return {
    x: state.width / (2 * zoom) - state.scrollX,
    y: state.height / (2 * zoom) - state.scrollY,
  }
}

async function imageSize(dataURL: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const image = new Image()
    const finish = () => {
      const width = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : 640
      const height = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : 480
      resolve({ width, height })
    }
    image.onload = finish
    image.onerror = () => resolve({ width: 640, height: 480 })
    image.src = dataURL
  })
}

function fitImageSize(width: number, height: number): { width: number; height: number } {
  const max = 720
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(40, width * scale),
    height: Math.max(40, height * scale),
  }
}

export async function createCanvasImage(file: File, api: ExcalidrawImperativeAPI): Promise<{
  file: BinaryFileData
  element: MediaSceneElement
}> {
  const id = await generateCanvasFileId(file)
  const dataURL = await blobToDataUrl(file)
  const binaryFile: BinaryFileData = {
    id: id as BinaryFileData['id'],
    mimeType: file.type as BinaryFileData['mimeType'],
    dataURL,
    created: Date.now(),
  }
  const natural = await imageSize(dataURL)
  const size = fitImageSize(natural.width, natural.height)
  const center = sceneCenter(api)
  const [base] = convertToExcalidrawElements([{
    type: 'rectangle',
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    roughness: 0,
  }])
  if (!base) throw new Error('Canvas could not create the image element.')
  const element = {
    ...base,
    type: 'image',
    fileId: binaryFile.id,
    status: 'pending',
    scale: [1, 1] as [number, number],
    crop: null,
    strokeColor: 'transparent',
  } as MediaSceneElement
  return { file: binaryFile, element }
}

function randomElementId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}

function randomVersionNonce(): number {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return bytes[0] & 0x7fffffff
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value)
}

function remapImportedElements(rawElements: unknown[], fileMap: Map<string, string>): unknown[] {
  const objects = rawElements.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
  const idMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  for (const element of objects) {
    if (typeof element.id === 'string') idMap.set(element.id, randomElementId())
    if (Array.isArray(element.groupIds)) {
      for (const groupId of element.groupIds) if (typeof groupId === 'string' && !groupMap.has(groupId)) groupMap.set(groupId, randomElementId())
    }
  }
  const mapId = (value: unknown) => typeof value === 'string' ? idMap.get(value) ?? null : null

  return objects.flatMap(original => {
    const element = cloneRecord(original)
    const oldId = typeof element.id === 'string' ? element.id : ''
    if (!oldId || !idMap.has(oldId)) return []
    element.id = idMap.get(oldId)!
    element.version = 1
    element.versionNonce = randomVersionNonce()
    element.updated = Date.now()
    element.isDeleted = false
    element.index = null
    element.groupIds = Array.isArray(element.groupIds)
      ? element.groupIds.flatMap(groupId => typeof groupId === 'string' && groupMap.has(groupId) ? [groupMap.get(groupId)!] : [])
      : []
    if (element.frameId) element.frameId = mapId(element.frameId)
    if (element.containerId) element.containerId = mapId(element.containerId)
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.flatMap(binding => {
        if (!binding || typeof binding !== 'object') return []
        const next = { ...(binding as Record<string, unknown>) }
        const id = mapId(next.id)
        if (!id) return []
        next.id = id
        return [next]
      })
    }
    for (const key of ['startBinding', 'endBinding']) {
      const binding = element[key]
      if (!binding || typeof binding !== 'object') continue
      const next = { ...(binding as Record<string, unknown>) }
      const id = mapId(next.elementId)
      element[key] = id ? { ...next, elementId: id } : null
    }
    if (element.type === 'image') {
      const oldFileId = typeof element.fileId === 'string' ? element.fileId : ''
      const nextFileId = fileMap.get(oldFileId)
      if (!nextFileId) return []
      element.fileId = nextFileId
      element.status = 'pending'
      element.scale = Array.isArray(element.scale) && element.scale.length === 2 ? element.scale : [1, 1]
      element.crop = element.crop ?? null
    }
    return [element]
  })
}

export async function prepareCanvasJsonImport(text: string): Promise<{
  elements: MediaSceneElement[]
  files: BinaryFiles
}> {
  const imported = parseCanvasImport(text)
  const fileMap = new Map<string, string>()
  const files: BinaryFiles = {}
  for (const [oldId, rawFile] of Object.entries(imported.files)) {
    if (!rawFile || !isSupportedImageMime(rawFile.mimeType) || !rawFile.dataURL) continue
    const blob = await dataUrlToBlob(rawFile.dataURL)
    const nextId = await sha256BlobId(blob)
    fileMap.set(oldId, nextId)
    files[nextId] = {
      ...rawFile,
      id: nextId as BinaryFileData['id'],
      dataURL: await blobToDataUrl(blob),
      created: rawFile.created || Date.now(),
    }
  }
  const remapped = remapImportedElements(imported.elements, fileMap)
  const restored = restoreElements(remapped as MediaSceneElement[], null, {
    repairBindings: false,
    refreshDimensions: false,
  }) as MediaSceneElement[]
  return { elements: restored, files }
}

export function createBookmarkCard(urlText: string, api: ExcalidrawImperativeAPI): MediaSceneElement[] | null {
  let url: URL
  try {
    url = new URL(urlText.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const center = sceneCenter(api)
  const path = url.pathname === '/' ? '' : url.pathname
  const label = `${url.hostname}${path}`.slice(0, 90)
  return convertToExcalidrawElements([{
    type: 'rectangle',
    x: center.x - 150,
    y: center.y - 45,
    width: 300,
    height: 90,
    backgroundColor: '#f8f9fa',
    strokeColor: '#868e96',
    fillStyle: 'solid',
    roughness: 0,
    link: url.href,
    label: {
      text: label,
      fontSize: 18,
      textAlign: 'left',
      verticalAlign: 'middle',
      strokeColor: '#212529',
    },
  }]) as MediaSceneElement[]
}

export function insertElements(api: ExcalidrawImperativeAPI, elements: MediaSceneElement[], files: BinaryFiles = {}): void {
  if (Object.keys(files).length) api.addFiles(Object.values(files))
  const current = api.getSceneElementsIncludingDeleted()
  const selectedElementIds = Object.fromEntries(elements.map(element => [element.id, true]))
  api.updateScene({
    elements: [...current, ...elements],
    appState: { selectedElementIds, selectedGroupIds: {}, editingGroupId: null },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  api.setActiveTool({ type: 'selection' })
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportName(extension: string): string {
  return `Canvas-${new Date().toISOString().replace(/[:.]/g, '-') }.${extension}`
}

async function dimensionsOfBlob(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Canvas could not measure the PDF image.'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportCanvasScene(api: ExcalidrawImperativeAPI, format: CanvasExportFormat): Promise<void> {
  const elements = api.getSceneElements().filter(element => !element.isDeleted)
  if (!elements.length) throw new Error('There is nothing to export.')
  const files = api.getFiles()
  const appState = {
    ...api.getAppState(),
    exportBackground: true,
    exportWithDarkMode: false,
    exportEmbedScene: false,
  } as AppState

  if (format === 'json') {
    const backup = createCanvasBackup(elements, files)
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), exportName('json'))
    return
  }

  if (format === 'svg') {
    const svg = await exportToSvg({ elements, appState, files })
    const text = new XMLSerializer().serializeToString(svg)
    downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'))
    return
  }

  if (format === 'png') {
    const blob = await exportToBlob({ elements, appState, files, mimeType: 'image/png' })
    downloadBlob(blob, exportName('png'))
    return
  }

  const jpeg = await exportToBlob({ elements, appState, files, mimeType: 'image/jpeg', quality: 0.92 })
  const dimensions = await dimensionsOfBlob(jpeg)
  const pdf = jpegBytesToPdf(new Uint8Array(await jpeg.arrayBuffer()), dimensions.width, dimensions.height)
  downloadBlob(pdf, exportName('pdf'))
}

export function referencedMissingFiles(api: ExcalidrawImperativeAPI, elements: readonly MediaSceneElement[]): string[] {
  const have = api.getFiles()
  return [...referencedAssetIds(elements)].filter(id => !have[id])
}

export function markImagesSaved(elements: readonly MediaSceneElement[], fileId: string): MediaSceneElement[] {
  return elements.map(element => element.type === 'image' && element.fileId === fileId && element.status !== 'saved'
    ? newElementWith(element, { status: 'saved' }) as MediaSceneElement
    : element)
}

export function markImagesErrored(elements: readonly MediaSceneElement[], fileId: string): MediaSceneElement[] {
  return elements.map(element => element.type === 'image' && element.fileId === fileId && element.status !== 'error'
    ? newElementWith(element, { status: 'error' }) as MediaSceneElement
    : element)
}
