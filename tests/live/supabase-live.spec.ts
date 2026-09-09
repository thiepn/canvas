import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type StoredRow = {
  id: string
  version: number
  version_nonce: number
  is_deleted: boolean
  element: Record<string, unknown>
}

async function cleanTestWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function latestActiveId(): Promise<string> {
  const { data, error } = await supabase.from(TABLE).select('id,is_deleted,updated_at').eq('is_deleted', false).order('updated_at', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0]?.id ?? ''
}

async function activeRow(id: string): Promise<StoredRow | null> {
  const { data, error } = await supabase.from(TABLE).select('id,version,version_nonce,is_deleted,element').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (error) throw error
  if (!data || !data.element || typeof data.element !== 'object') return null
  return data as StoredRow
}

async function isDeleted(id: string): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).select('is_deleted').eq('id', id).maybeSingle()
  if (error) throw error
  return data?.is_deleted === true
}

async function exportElement(page: Page, id: string): Promise<Record<string, unknown> | null> {
  const settings = page.getByLabel('Canvas settings')
  if (!(await settings.isVisible())) await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  await expect(settings).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    settings.getByRole('button', { name: 'Export JSON backup' }).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Canvas backup download has no local path.')
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { elements?: Array<Record<string, unknown>> }
  return parsed.elements?.find(element => element.id === id) ?? null
}

async function createRectangle(page: Page): Promise<string> {
  const surface = page.locator('.live-excalidraw')
  const box = await surface.boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')

  const rectangleTool = page.getByRole('radio', { name: /^Rectangle\b/i })
  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(rectangleTool).toBeChecked()

  await page.mouse.move(box.x + 300, box.y + 250)
  await page.mouse.down()
  await page.mouse.move(box.x + 430, box.y + 330, { steps: 8 })
  await page.mouse.up()

  let id = ''
  await expect.poll(async () => {
    id = await latestActiveId()
    return id
  }).not.toBe('')
  return id
}

test.beforeEach(cleanTestWorld)
test.afterEach(cleanTestWorld)

test('two live clients persist and synchronize a real rectangle through Supabase', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', error => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', error => pageErrors.push(`B: ${error.message}`))

  try {
    await test.step('connect both clients to the live Supabase canvas', async () => {
      await Promise.all([pageA.goto('./'), pageB.goto('./')])
      await expect(pageA.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
      await expect(pageB.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
      await expect(pageA.getByText('Live', { exact: true })).toBeVisible()
      await expect(pageB.getByText('Live', { exact: true })).toBeVisible()
      await expect(pageB.getByLabel('2 people connected')).toBeVisible()
    })

    const elementId = await test.step('client A creates and persists a rectangle', () => createRectangle(pageA))

    await test.step('client B receives and deletes the rectangle', async () => {
      const surfaceB = pageB.locator('.live-excalidraw')
      const boxB = await surfaceB.boundingBox()
      if (!boxB) throw new Error('Peer Excalidraw surface has no bounding box.')

      const eraserTool = pageB.getByRole('radio', { name: /^Eraser\b/i })
      await pageB.getByTitle(/^Eraser\b/i).click()
      await expect(eraserTool).toBeChecked()

      await pageB.mouse.move(boxB.x + 280, boxB.y + 290)
      await pageB.mouse.down()
      await pageB.mouse.move(boxB.x + 450, boxB.y + 290, { steps: 12 })
      await pageB.mouse.up()

      await expect.poll(() => isDeleted(elementId)).toBe(true)
    })

    expect(pageErrors).toEqual([])
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})

test('same-element equal-version conflict converges in both real clients', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', error => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', error => pageErrors.push(`B: ${error.message}`))

  try {
    await Promise.all([pageA.goto('./'), pageB.goto('./')])
    await Promise.all([
      expect(pageA.getByText('Live', { exact: true })).toBeVisible(),
      expect(pageB.getByText('Live', { exact: true })).toBeVisible(),
    ])

    const elementId = await createRectangle(pageA)
    await expect.poll(async () => Boolean(await exportElement(pageB, elementId))).toBe(true)

    const stored = await activeRow(elementId)
    if (!stored) throw new Error('Persisted rectangle disappeared before conflict test.')
    const currentX = Number(stored.element.x)
    if (!Number.isFinite(currentX)) throw new Error('Persisted rectangle has an invalid x coordinate.')

    const winningNonce = stored.version_nonce - 1
    const winningX = currentX + 180
    const winningElement = { ...stored.element, x: winningX, versionNonce: winningNonce }
    const { error } = await supabase.from(TABLE).update({
      version_nonce: winningNonce,
      element: winningElement,
      updated_by: 'same-element-conflict-test',
    }).eq('id', elementId)
    expect(error).toBeNull()

    await expect.poll(async () => Number((await exportElement(pageA, elementId))?.x)).toBe(winningX)
    await expect.poll(async () => Number((await exportElement(pageB, elementId))?.x)).toBe(winningX)
    await expect.poll(async () => Number((await exportElement(pageA, elementId))?.versionNonce)).toBe(winningNonce)
    await expect.poll(async () => Number((await exportElement(pageB, elementId))?.versionNonce)).toBe(winningNonce)

    expect(pageErrors).toEqual([])
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
