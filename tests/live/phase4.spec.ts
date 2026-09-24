import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

async function rows() {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('element,is_deleted'))
  if (error) throw error
  return (data ?? []).filter(row => !row.is_deleted).map(row => row.element as Record<string, unknown>)
}

async function openDrawing(page: Page) {
  await page.getByRole('button', { name: 'Drawing tools' }).click()
  await expect(page.getByLabel('Drawing tools menu')).toBeVisible()
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('pen uses exact width, smoothing and pressure settings on persisted freedraw strokes', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await openDrawing(page)
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.getByLabel('Pen color').fill('#2563eb')
  await page.getByLabel('Drawing width').fill('6')
  await page.getByLabel('Smoothing').fill('80')
  await page.getByRole('button', { name: 'Pressure' }).click()
  await page.keyboard.press('Escape')

  await dragOnCanvas(page, [300, 220], [620, 300], 10)

  await expect.poll(async () => {
    const stroke = (await rows()).find(element => element.type === 'freedraw')
    if (!stroke) return false
    const options = stroke.strokeOptions as Record<string, unknown> | undefined
    const drawing = (stroke.customData as Record<string, unknown> | undefined)?.canvasDrawing as Record<string, unknown> | undefined
    return stroke.strokeColor === '#2563eb'
      && Number(stroke.strokeWidth) === 6
      && Number(options?.streamline) === 0.8
      && options?.variability === 'constant'
      && drawing?.kind === 'pen'
  }).toBe(true)
})

test('highlighter persists as a wide translucent constant-width stroke', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await openDrawing(page)
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()
  await page.getByLabel('Highlight color').fill('#fff3bf')
  await page.getByLabel('Drawing width').fill('18')
  await page.keyboard.press('Escape')
  await dragOnCanvas(page, [300, 260], [650, 260], 10)

  await expect.poll(async () => {
    const stroke = (await rows()).find(element => element.type === 'freedraw')
    if (!stroke) return false
    const drawing = (stroke.customData as Record<string, unknown> | undefined)?.canvasDrawing as Record<string, unknown> | undefined
    return Number(stroke.strokeWidth) === 18
      && Number(stroke.opacity) === 32
      && drawing?.kind === 'highlighter'
  }).toBe(true)
})

test('partial stroke eraser splits a freehand stroke without deleting the whole object', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Partial eraser interaction contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await openDrawing(page)
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  await dragOnCanvas(page, [280, 260], [720, 260], 14)
  await expect.poll(async () => (await rows()).filter(element => element.type === 'freedraw').length).toBe(1)

  await openDrawing(page)
  await page.getByRole('button', { name: 'Stroke erase' }).click()
  await dragOnCanvas(page, [500, 220], [500, 300], 8)

  await expect.poll(async () => (await rows()).filter(element => element.type === 'freedraw').length).toBe(2)
})

test('hold-to-clean straightens a rough freehand line into a native line', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Hold gesture timing contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await openDrawing(page)
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')

  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Canvas has no bounding box.')
  await page.mouse.move(box.x + 300, box.y + 220)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(box.x + 300 + step * 40, box.y + 220 + (step % 2 ? 2 : -2))
    await page.waitForTimeout(24)
  }
  await page.waitForTimeout(460)
  await page.mouse.up()

  await expect.poll(async () => {
    const elements = await rows()
    return {
      lines: elements.filter(element => element.type === 'line').length,
      free: elements.filter(element => element.type === 'freedraw').length,
    }
  }).toEqual({ lines: 1, free: 0 })
})
