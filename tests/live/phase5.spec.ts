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

async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, from, to)
}

async function canvasBox(page: Page) {
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Canvas has no bounding box.')
  return box
}

async function selectRectangleEdges(page: Page, rectangles: Array<Record<string, unknown>>) {
  const box = await canvasBox(page)
  await page.keyboard.press('v')
  for (let index = 0; index < rectangles.length; index++) {
    const rectangle = rectangles[index]
    if (index) await page.keyboard.down('Shift')
    await page.mouse.click(
      box.x + Number(rectangle.x) + 1,
      box.y + Number(rectangle.y) + Number(rectangle.height) / 2,
    )
    if (index) await page.keyboard.up('Shift')
  }
  await expect(page.getByRole('toolbar', { name: 'Selection tools' })).toBeVisible()
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('navigation overlay exposes minimap, zoom presets and persistent Home view', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Navigation preference contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await drawRectangle(page, [300, 180], [420, 260])

  const navigation = page.getByRole('toolbar', { name: 'Canvas navigation' })
  await expect(navigation).toBeVisible()
  await expect(page.getByLabel('Canvas minimap')).toBeVisible()

  await navigation.getByLabel('Zoom presets').click()
  await navigation.getByRole('button', { name: '200%' }).click()
  await expect(navigation.locator('.navigation-zoom')).toHaveText('200%')

  await navigation.getByLabel('Zoom presets').click()
  await navigation.getByRole('button', { name: 'Set home' }).click()
  await navigation.getByLabel('Zoom presets').click()
  await navigation.getByRole('button', { name: '50%' }).click()
  await expect(navigation.locator('.navigation-zoom')).toHaveText('50%')
  await navigation.getByRole('button', { name: 'Go to home view' }).click()
  await expect(navigation.locator('.navigation-zoom')).toHaveText('200%')

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const reloadedNav = page.getByRole('toolbar', { name: 'Canvas navigation' })
  await reloadedNav.getByRole('button', { name: 'Go to home view' }).click()
  await expect(reloadedNav.locator('.navigation-zoom')).toHaveText('200%')
})

test('canvas search finds rich text and navigates to it across browsers', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Rich text' }).click()
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 430, box.y + 270)
  const editor = page.locator('.rich-text-editor')
  await expect(editor).toBeVisible()
  await editor.pressSequentially('Spatial navigation needle')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.keyboard.press('Control+f')
  const search = page.getByLabel('Canvas search')
  await expect(search).toBeVisible()
  await search.getByLabel('Search canvas text').fill('navigation needle')
  await expect(search.locator('.navigation-result-list > button')).toHaveCount(1)
  await search.locator('.navigation-result-list > button').click()
  await expect(page.getByRole('toolbar', { name: 'Rich text formatting' })).toBeVisible()
})

test('frame selection, rename, auto-fit and content locking persist', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Frame workflow persistence needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await drawRectangle(page, [280, 180], [350, 235])
  await drawRectangle(page, [500, 300], [590, 370])
  await expect.poll(async () => (await rows()).filter(element => element.type === 'rectangle').length).toBe(2)

  const rectangles = (await rows()).filter(element => element.type === 'rectangle')
  await selectRectangleEdges(page, rectangles)
  let toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  await toolbar.getByText('Frame', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Frame selection' }).click()

  let frameId = ''
  await expect.poll(async () => {
    const elements = await rows()
    const frame = elements.find(element => element.type === 'frame')
    if (!frame) return false
    frameId = String(frame.id)
    const children = elements.filter(element => element.type === 'rectangle')
    return children.length === 2 && children.every(element => element.frameId === frameId)
  }).toBe(true)

  toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  const frameName = toolbar.getByLabel('Frame name')
  if (!(await frameName.isVisible())) await toolbar.getByText('Frame', { exact: true }).click()
  await expect(frameName).toBeVisible()
  await frameName.fill('Research Cluster')
  await frameName.press('Enter')
  await toolbar.getByRole('button', { name: 'Auto-fit' }).click()
  await toolbar.getByRole('button', { name: 'Lock contents' }).click()

  await expect.poll(async () => {
    const elements = await rows()
    const frame = elements.find(element => element.id === frameId)
    const children = elements.filter(element => element.frameId === frameId)
    return frame?.name === 'Research Cluster'
      && children.length === 2
      && children.every(element => element.locked === true)
  }).toBe(true)

  await toolbar.getByRole('button', { name: 'Unlock contents' }).click()
  await expect.poll(async () => (await rows()).filter(element => element.frameId === frameId).every(element => element.locked !== true)).toBe(true)

  const navigation = page.getByRole('toolbar', { name: 'Canvas navigation' })
  await navigation.getByRole('button', { name: 'Show frames' }).click()
  const frames = page.getByLabel('Canvas frames')
  await expect(frames.getByRole('button', { name: /Research Cluster/ })).toBeVisible()
})

test('zoom to selection and frame use spatial navigation without changing scene data', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Viewport-only navigation needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await drawRectangle(page, [360, 220], [430, 280])
  await expect.poll(async () => (await rows()).filter(element => element.type === 'rectangle').length).toBe(1)
  const before = await rows()
  const rectangle = before.find(element => element.type === 'rectangle')
  if (!rectangle) throw new Error('Expected rectangle.')
  await selectRectangleEdges(page, [rectangle])

  const navigation = page.getByRole('toolbar', { name: 'Canvas navigation' })
  await navigation.getByLabel('Zoom presets').click()
  await navigation.getByRole('button', { name: '200%' }).click()
  await navigation.getByRole('button', { name: 'Zoom to selection' }).click()
  await expect.poll(async () => Number.parseInt((await navigation.locator('.navigation-zoom').textContent()) ?? '0', 10)).toBeLessThanOrEqual(100)
  expect(await rows()).toEqual(before)
})
