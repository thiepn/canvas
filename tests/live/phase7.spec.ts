import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const BUCKET = 'canvas-ci-assets'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const SVG_A = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="12" fill="#2563eb"/></svg>')
const SVG_B = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100" viewBox="0 0 180 100"><circle cx="90" cy="50" r="44" fill="#dc2626"/></svg>')
const ID_A = createHash('sha256').update(SVG_A).digest('hex')
const ID_B = createHash('sha256').update(SVG_B).digest('hex')
const PATH_A = `sha256/${ID_A}`
const PATH_B = `sha256/${ID_B}`

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
  await Promise.allSettled([
    supabase.storage.from(BUCKET).remove([PATH_A]),
    supabase.storage.from(BUCKET).remove([PATH_B]),
  ])
}

async function rows() {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('id,version,element,is_deleted'))
  if (error) throw error
  return (data ?? []).filter(row => !row.is_deleted).map(row => ({
    id: row.id as string,
    version: Number(row.version),
    element: row.element as Record<string, unknown>,
  }))
}

async function openMediaMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'Images and transfer' })
  await trigger.click()
  const menu = page.getByLabel('Images and transfer menu')
  await expect(menu).toBeVisible()
  return menu
}

async function chooseImage(page: Page, buffer: Buffer, name: string) {
  const menu = await openMediaMenu(page)
  const chooserPromise = page.waitForEvent('filechooser')
  await menu.getByRole('button', { name: 'Image', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name, mimeType: 'image/svg+xml', buffer })
}

async function exportFormat(page: Page, format: 'JSON' | 'PNG' | 'SVG' | 'PDF'): Promise<Download> {
  const menu = await openMediaMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await menu.getByRole('button', { name: format, exact: true }).click()
  return downloadPromise
}

async function parseDownload(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Download did not expose a local path.')
  return { path, bytes: await readFile(path) }
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('image upload, native manipulation, replacement, Storage reload and portable JSON import stay coherent', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 7 image lifecycle contract needs one browser execution.')
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await chooseImage(page, SVG_A, 'phase7-a.svg')

  let imageId = ''
  let versionA = 0
  await expect.poll(async () => {
    const image = (await rows()).find(row => row.element.type === 'image')
    if (!image) return null
    imageId = image.id
    versionA = image.version
    return {
      fileId: image.element.fileId,
      status: image.element.status,
      scale: image.element.scale,
    }
  }).toEqual({ fileId: ID_A, status: 'saved', scale: [1, 1] })

  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Selection tools' }).getByRole('button', { name: 'Replace image' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crop image' })).toBeVisible()
  const opacity = page.getByTestId('opacity')
  await expect(opacity).toBeVisible()
  await opacity.focus()
  await page.keyboard.press('Home')
  for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight')

  let manipulatedVersion = versionA
  await expect.poll(async () => {
    const image = (await rows()).find(row => row.id === imageId)
    if (!image || Number(image.element.opacity) !== 60) return false
    manipulatedVersion = image.version
    return manipulatedVersion > versionA
  }).toBe(true)

  const storedA = await supabase.storage.from(BUCKET).download(PATH_A)
  expect(storedA.error).toBeNull()
  expect(Buffer.from(await storedA.data!.arrayBuffer())).toEqual(SVG_A)

  const replaceChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('toolbar', { name: 'Selection tools' }).getByRole('button', { name: 'Replace image' }).click()
  const replaceChooser = await replaceChooserPromise
  await replaceChooser.setFiles({ name: 'phase7-b.svg', mimeType: 'image/svg+xml', buffer: SVG_B })

  await expect.poll(async () => {
    const image = (await rows()).find(row => row.id === imageId)
    return Boolean(
      image
      && image.element.fileId === ID_B
      && image.element.status === 'saved'
      && Number(image.element.opacity) === 60
      && image.version > manipulatedVersion
    )
  }).toBe(true)

  const storedB = await supabase.storage.from(BUCKET).download(PATH_B)
  expect(storedB.error).toBeNull()
  expect(Buffer.from(await storedB.data!.arrayBuffer())).toEqual(SVG_B)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()
  await expect.poll(async () => {
    const snapshot = await page.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
    return snapshot?.counters.assetDownloadsCompleted ?? 0
  }).toBeGreaterThan(0)

  const backupDownload = await exportFormat(page, 'JSON')
  const backupFile = await parseDownload(backupDownload)
  const backup = JSON.parse(backupFile.bytes.toString('utf8')) as {
    version: number
    elements: Array<Record<string, unknown>>
    files: Record<string, { dataURL?: string }>
  }
  expect(backup.version).toBe(3)
  expect(backup.elements.filter(element => element.type === 'image')).toHaveLength(1)
  expect(Object.keys(backup.files)).toEqual([ID_B])
  expect(backup.files[ID_B].dataURL).toMatch(/^data:image\/svg\+xml;base64,/)

  const menu = await openMediaMenu(page)
  const importChooserPromise = page.waitForEvent('filechooser')
  await menu.getByRole('button', { name: 'Import file' }).click()
  const importChooser = await importChooserPromise
  await importChooser.setFiles(backupFile.path)

  await expect.poll(async () => {
    const images = (await rows()).filter(row => row.element.type === 'image')
    return {
      count: images.length,
      ids: new Set(images.map(image => image.id)).size,
      files: [...new Set(images.map(image => String(image.element.fileId)))],
      saved: images.every(image => image.element.status === 'saved'),
    }
  }).toEqual({ count: 2, ids: 2, files: [ID_B], saved: true })
})

test('PNG, SVG, PDF and JSON exports produce the requested portable formats', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Export format contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [320, 220], [520, 340])
  await expect.poll(async () => (await rows()).filter(row => row.element.type === 'rectangle').length).toBe(1)

  const json = await parseDownload(await exportFormat(page, 'JSON'))
  expect(json.bytes.toString('utf8')).toContain('"type": "canvas-backup"')

  const png = await parseDownload(await exportFormat(page, 'PNG'))
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  const svg = await parseDownload(await exportFormat(page, 'SVG'))
  expect(svg.bytes.toString('utf8')).toMatch(/<svg[\s>]/)

  const pdf = await parseDownload(await exportFormat(page, 'PDF'))
  expect(pdf.bytes.subarray(0, 8).toString('latin1')).toMatch(/^%PDF-1\.4/)
  expect(pdf.bytes.subarray(-32).toString('latin1')).toContain('%%EOF')
})

test('pasting a standalone HTTP URL creates a normal linked canvas card', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard URL contract needs one browser execution.')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/research/path'))
  await page.keyboard.press('Control+V')

  await expect.poll(async () => {
    const linked = (await rows()).find(row => row.element.link === 'https://example.com/research/path')
    return linked ? { type: linked.element.type, link: linked.element.link } : null
  }).toEqual({ type: 'rectangle', link: 'https://example.com/research/path' })
})

test('image clipboard survives reload and deduplicates the shared asset by content hash', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Cross-session image clipboard contract needs one browser execution.')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await chooseImage(page, SVG_A, 'phase7-clipboard.svg')
  await expect.poll(async () => {
    const image = (await rows()).find(row => row.element.type === 'image')
    return image ? { fileId: image.element.fileId, status: image.element.status } : null
  }).toEqual({ fileId: ID_A, status: 'saved' })

  await expect(page.getByRole('toolbar', { name: 'Selection tools' })).toBeVisible()
  await page.keyboard.press('Control+C')

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()
  await page.keyboard.press('Control+V')

  await expect.poll(async () => {
    const images = (await rows()).filter(row => row.element.type === 'image')
    return {
      count: images.length,
      distinctIds: new Set(images.map(image => image.id)).size,
      fileIds: [...new Set(images.map(image => String(image.element.fileId)))],
      saved: images.every(image => image.element.status === 'saved'),
    }
  }).toEqual({ count: 2, distinctIds: 2, fileIds: [ID_A], saved: true })

  const stored = await supabase.storage.from(BUCKET).download(PATH_A)
  expect(stored.error).toBeNull()
  expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(SVG_A)
})

test('immutable asset collision stays unsaved until Retry now can persist the correct bytes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Storage collision integrity needs one browser execution.')

  // Deliberately omit viewBox so this fixture also certifies the canonical SVG
  // identity contract used by Excalidraw, Storage, clipboard, and backups.
  const nonce = `${Date.now()}-${Math.random()}`
  const intended = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" data-nonce="${nonce}"><rect width="96" height="64" fill="#2563eb"/></svg>`)
  const poison = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><rect width="96" height="64" fill="#dc2626"/></svg>`)

  let collisionId = ''
  let collisionPath = ''
  try {
    // First discover the browser's canonical content-addressed ID through the
    // real successful image path rather than duplicating SVG normalization in
    // the test runner.
    await page.goto('./?debug=1')
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await chooseImage(page, intended, 'phase7-canonical-svg.svg')

    let probeElementId = ''
    await expect.poll(async () => {
      const image = (await rows()).find(row => row.element.type === 'image')
      if (!image) return null
      probeElementId = image.id
      collisionId = String(image.element.fileId)
      collisionPath = `sha256/${collisionId}`
      return image.element.status
    }).toBe('saved')
    expect(collisionId).toMatch(/^[0-9a-f]{64}$/)

    const canonical = await supabase.storage.from(BUCKET).download(collisionPath)
    expect(canonical.error).toBeNull()
    const canonicalBytes = Buffer.from(await canonical.data!.arrayBuffer())
    expect(createHash('sha256').update(canonicalBytes).digest('hex')).toBe(collisionId)
    expect(canonicalBytes.toString('utf8')).toContain('viewBox="0 0 96 64"')

    const { error: probeDeleteError } = await supabase.from(TABLE).delete().eq('id', probeElementId)
    expect(probeDeleteError).toBeNull()
    const removedCanonical = await supabase.storage.from(BUCKET).remove([collisionPath])
    expect(removedCanonical.error).toBeNull()

    await page.reload()
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expect.poll(async () => (await rows()).length).toBe(0)

    const poisoned = await supabase.storage.from(BUCKET).upload(collisionPath, poison, {
      contentType: 'image/svg+xml',
      upsert: false,
    })
    expect(poisoned.error).toBeNull()

    await chooseImage(page, intended, 'phase7-collision.svg')

    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
      return snapshot?.counters.assetUploadFailures ?? 0
    }).toBeGreaterThan(0)
    await expect(page.getByText('Image not saved', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible()
    await expect.poll(async () => (await rows()).filter(row => row.element.type === 'image').length).toBe(0)

    const poisonedStored = await supabase.storage.from(BUCKET).download(collisionPath)
    expect(poisonedStored.error).toBeNull()
    expect(Buffer.from(await poisonedStored.data!.arrayBuffer())).toEqual(poison)

    const removed = await supabase.storage.from(BUCKET).remove([collisionPath])
    expect(removed.error).toBeNull()
    await page.getByRole('button', { name: 'Retry now' }).click()

    await expect.poll(async () => {
      const image = (await rows()).find(row => row.element.type === 'image')
      return image ? { fileId: image.element.fileId, status: image.element.status } : null
    }).toEqual({ fileId: collisionId, status: 'saved' })
    await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()

    const stored = await supabase.storage.from(BUCKET).download(collisionPath)
    expect(stored.error).toBeNull()
    const storedBytes = Buffer.from(await stored.data!.arrayBuffer())
    expect(createHash('sha256').update(storedBytes).digest('hex')).toBe(collisionId)
  } finally {
    if (collisionPath) await supabase.storage.from(BUCKET).remove([collisionPath])
  }
})
