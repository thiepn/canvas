import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas, exportElement, readScene } from './scene-helpers.ts'

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

async function createRectangle(page: Page): Promise<string> {
  const rectangleTool = page.getByRole('radio', { name: /^Rectangle\b/i })
  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(rectangleTool).toBeChecked()
  await dragOnCanvas(page, [300, 250], [430, 330])

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
      // A successful database write does not mean B has rendered the event yet.
      await expect.poll(async () => Boolean(await exportElement(pageB, elementId))).toBe(true)
      const eraserTool = pageB.getByRole('radio', { name: /^Eraser\b/i })
      await pageB.getByTitle(/^Eraser\b/i).click()
      await expect(eraserTool).toBeChecked()
      await dragOnCanvas(pageB, [280, 290], [450, 290], 12)
      await expect.poll(() => isDeleted(elementId)).toBe(true)
      await expect.poll(() => exportElement(pageA, elementId)).toBeNull()
    })

    await test.step('both clients reload the durable deletion', async () => {
      await Promise.all([pageA.reload(), pageB.reload()])
      for (const page of [pageA, pageB]) {
        await expect(page.getByText('Live', { exact: true })).toBeVisible()
        expect(await exportElement(page, elementId)).toBeNull()
      }
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

test('repeated reconnects recover missed peer edits and resume real drawing without reload', async ({ browser }) => {
  test.setTimeout(120_000)
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const errors: string[] = []
  pageA.on('pageerror', error => errors.push(error.message))
  pageB.on('pageerror', error => errors.push(error.message))
  try {
    await Promise.all([pageA.goto('./'), pageB.goto('./')])
    for (const page of [pageA, pageB]) await expect(page.getByText('Live', { exact: true })).toBeVisible()
    const id = await createRectangle(pageB)
    await expect.poll(async () => Boolean(await exportElement(pageA, id))).toBe(true)
    const stored = await activeRow(id)
    if (!stored) throw new Error('Missing reconnect test shape.')

    for (let cycle = 1; cycle <= 2; cycle++) {
      await contextA.setOffline(true)
      await expect(pageA.getByText('Offline', { exact: true })).toBeVisible()
      await expect(pageA.getByRole('button', { name: 'Frame tool' })).toBeDisabled()
      const version = stored.version + cycle
      const element = { ...stored.element, x: Number(stored.element.x) + cycle * 70, version, versionNonce: 100 + cycle }
      const { error } = await supabase.from(TABLE).update({ version, version_nonce: 100 + cycle, element, updated_by: 'reconnect-peer' }).eq('id', id)
      expect(error).toBeNull()
      await expect.poll(async () => (await exportElement(pageB, id))?.x).toBe(element.x)

      await contextA.setOffline(false)
      await expect(pageA.getByText('Live', { exact: true })).toBeVisible()
      await expect(pageA.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
      await expect.poll(async () => (await exportElement(pageA, id))?.x).toBe(element.x)
      await expect(pageA.getByLabel('2 people connected')).toBeVisible()
    }

    await pageA.getByTitle(/^Ellipse\b/i).click()
    await expect(pageA.getByRole('radio', { name: /^Ellipse\b/i })).toBeChecked()
    await dragOnCanvas(pageA, [600, 250], [710, 330])
    await expect.poll(async () => (await readScene(pageB)).some(element => element.type === 'ellipse')).toBe(true)
    await pageA.reload()
    await expect(pageA.getByText('Live', { exact: true })).toBeVisible()
    expect((await readScene(pageA)).some(element => element.type === 'ellipse')).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
