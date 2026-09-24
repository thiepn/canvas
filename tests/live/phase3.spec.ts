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

async function rows(): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('element,is_deleted'))
  if (error) throw error
  return (data ?? []).filter(row => !row.is_deleted).map(row => row.element as Record<string, unknown>)
}

async function canvasBox(page: Page) {
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Canvas has no bounding box.')
  return box
}

async function selectPoint(page: Page, x: number, y: number) {
  const box = await canvasBox(page)
  await page.keyboard.press('v')
  await page.mouse.click(box.x + x, box.y + y)
  await expect(page.getByRole('toolbar', { name: 'Selection tools' })).toBeVisible()
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('custom Canvas shapes persist kind and advanced style through reload', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Shape library' }).click()
  await page.getByRole('button', { name: 'Star' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByText('Shape', { exact: true }).click()

  const shapePanel = toolbar.locator('.phase3-style-panel')
  await shapePanel.getByLabel('Shape stroke color').fill('#2563eb')
  await shapePanel.getByLabel('Shape fill color').fill('#fff3bf')
  await shapePanel.getByLabel('Shape fill mode').selectOption('hachure')
  await shapePanel.getByLabel('Shape stroke style').selectOption('dashed')
  await shapePanel.getByLabel('Shape stroke width').fill('4')
  await shapePanel.getByLabel('Shape opacity').fill('65')

  let shapeId = ''
  await expect.poll(async () => {
    const elements = await rows()
    const shape = elements.find(element => {
      const customData = element.customData as Record<string, unknown> | undefined
      return Boolean(customData?.canvasShape)
    })
    if (!shape) return false
    shapeId = String(shape.id)
    const data = (shape.customData as Record<string, unknown>).canvasShape as Record<string, unknown>
    const style = data.style as Record<string, unknown>
    return data.kind === 'star'
      && style.strokeColor === '#2563eb'
      && style.fillColor === '#fff3bf'
      && style.fillStyle === 'hachure'
      && style.strokeStyle === 'dashed'
      && Number(style.strokeWidth) === 4
      && Number(style.opacity) === 65
  }).toBe(true)

  await expect(page.locator(`[data-rich-text-id="${shapeId}"]`)).toHaveCount(0)
  await expect(page.locator('.canvas-custom-shape')).toHaveCount(1)
  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.locator('.canvas-custom-shape')).toHaveCount(1)
})

test('connector routing, heads and label survive the live persistence path', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByTitle(/^Arrow\b/i).click()
  await dragOnCanvas(page, [340, 250], [650, 330])
  await expect.poll(async () => (await rows()).filter(element => element.type === 'arrow').length).toBe(1)

  const [arrow] = (await rows()).filter(element => element.type === 'arrow')
  const centerX = Number(arrow.x) + Number(arrow.width) / 2
  const centerY = Number(arrow.y) + Number(arrow.height) / 2
  await selectPoint(page, centerX, centerY)

  const toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  await toolbar.getByText('Connector', { exact: true }).click()
  const connector = toolbar.locator('.phase3-connector-panel')
  await connector.getByRole('button', { name: 'Curved' }).click()
  await connector.getByRole('button', { name: 'Both' }).click()
  await connector.getByLabel('Connector label').fill('Connection')
  await connector.getByRole('button', { name: 'Apply' }).click()

  const arrowId = String(arrow.id)
  await expect.poll(async () => {
    const elements = await rows()
    const storedArrow = elements.find(element => element.id === arrowId)
    if (!storedArrow) return false
    const label = elements.find(element => element.type === 'text' && element.containerId === arrowId)
    const roundness = storedArrow.roundness as Record<string, unknown> | null
    return storedArrow.startArrowhead === 'arrow'
      && storedArrow.endArrowhead === 'arrow'
      && storedArrow.elbowed === false
      && Number(roundness?.type) === 2
      && Boolean(label)
      && label?.text === 'Connection'
  }).toBe(true)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const elements = await rows()
    return elements.some(element => element.type === 'text' && element.containerId === arrowId && element.text === 'Connection')
  }).toBe(true)
})

test('custom shapes remain normal manipulable canvas objects', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Custom shape manipulation contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Shape library' }).click()
  await page.getByRole('button', { name: 'Triangle' }).click()
  await expect.poll(async () => (await rows()).length).toBe(1)
  const [before] = await rows()

  const box = await canvasBox(page)
  const x = Number(before.x) + 1
  const y = Number(before.y) + Number(before.height) / 2
  await page.keyboard.press('v')
  await page.mouse.move(box.x + x, box.y + y)
  await page.mouse.down()
  await page.mouse.move(box.x + x + 90, box.y + y + 50, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => {
    const [after] = await rows()
    return [Math.round(Number(after.x) - Number(before.x)), Math.round(Number(after.y) - Number(before.y))]
  }).not.toEqual([0, 0])
})
