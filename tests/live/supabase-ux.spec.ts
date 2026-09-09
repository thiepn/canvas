import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanTestWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function activeTypes(): Promise<string[]> {
  const { data, error } = await supabase.from(TABLE).select('element,is_deleted').eq('is_deleted', false)
  if (error) throw error
  return (data ?? [])
    .map(row => row.element)
    .filter((element): element is Record<string, unknown> => Boolean(element) && typeof element === 'object')
    .map(element => typeof element.type === 'string' ? element.type : '')
    .filter(Boolean)
}

async function deletedCount(): Promise<number> {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('is_deleted', true)
  if (error) throw error
  return count ?? 0
}

async function canvasBox(page: Page) {
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  return box
}

async function selectTool(page: Page, title: RegExp, roleName: RegExp) {
  await page.getByTitle(title).click()
  await expect(page.getByRole('radio', { name: roleName })).toBeChecked()
}

async function selectFrameTool(page: Page) {
  await page.getByRole('button', { name: 'Frame tool' }).click()
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 8) {
  const box = await canvasBox(page)
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps })
  await page.mouse.up()
}

async function waitForType(type: string) {
  await expect.poll(async () => (await activeTypes()).filter(value => value === type).length).toBeGreaterThan(0)
}

test.beforeEach(cleanTestWorld)
test.afterEach(cleanTestWorld)

test('required vector tools persist through the real Excalidraw + Supabase path', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await expect(page.getByTestId('main-menu-trigger')).toBeHidden()
  await expect(page.locator('.default-sidebar-trigger')).toBeHidden()
  await expect(page.locator('.App-toolbar__extra-tools-trigger')).toBeHidden()
  await expect(page.getByTestId('toolbar-LaserPointer')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeVisible()

  await selectTool(page, /^Rectangle\b/i, /^Rectangle\b/i)
  await drag(page, [180, 150], [290, 220])
  await waitForType('rectangle')

  await selectTool(page, /^Ellipse\b/i, /^Ellipse\b/i)
  await drag(page, [330, 150], [430, 225])
  await waitForType('ellipse')

  await selectTool(page, /^Diamond\b/i, /^Diamond\b/i)
  await drag(page, [470, 150], [570, 230])
  await waitForType('diamond')

  await selectTool(page, /^Line\b/i, /^Line\b/i)
  await drag(page, [190, 285], [310, 335])
  await waitForType('line')

  await selectTool(page, /^Arrow\b/i, /^Arrow\b/i)
  await drag(page, [350, 285], [470, 335])
  await waitForType('arrow')

  await selectTool(page, /^Draw\b/i, /^Draw\b/i)
  await drag(page, [510, 285], [600, 340], 14)
  await waitForType('freedraw')

  await selectTool(page, /^Text\b/i, /^Text\b/i)
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 230, box.y + 410)
  await page.keyboard.type('Production path text')
  await page.keyboard.press('Escape')
  await waitForType('text')

  await selectFrameTool(page)
  await drag(page, [420, 385], [610, 485])
  await waitForType('frame')

  const beforeDelete = await deletedCount()
  await selectTool(page, /^Eraser\b/i, /^Eraser\b/i)
  await drag(page, [170, 185], [300, 185], 14)
  await expect.poll(deletedCount).toBeGreaterThan(beforeDelete)

  const types = await activeTypes()
  for (const type of ['ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'frame']) expect(types).toContain(type)
})

test('320px mobile shell stays contained and the identity/settings menu remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  const metrics = await page.evaluate(() => ({
    innerWidth,
    innerHeight,
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1)
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1)

  await expect(page.getByTestId('main-menu-trigger')).toBeHidden()
  await expect(page.locator('.default-sidebar-trigger')).toBeHidden()
  await expect(page.locator('.App-toolbar__extra-tools-trigger')).toBeHidden()

  const menuButton = page.getByRole('button', { name: 'Canvas menu and presence' })
  await expect(menuButton).toBeVisible()
  await menuButton.click()
  const settings = page.getByLabel('Canvas settings')
  await expect(settings).toBeVisible()
  await expect(settings.getByLabel('Display name')).toBeVisible()
  await expect(settings.getByLabel('Appearance')).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Frame tool' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Export JSON backup' })).toBeVisible()
})

test('offline state pauses editing and returns to Live after reconnect', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Offline', { exact: true })).toBeVisible()
  await expect(page.getByText(/editing is paused until the shared canvas is synchronized/i)).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
})

test('database independently rejects forbidden media records', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Backend contract needs one execution, not one per browser engine.')

  const id = `forbidden-image-${Date.now()}`
  const forbidden = {
    id,
    version: 1,
    version_nonce: 1,
    is_deleted: false,
    updated_by: 'production-e2e',
    element: {
      id,
      type: 'image',
      version: 1,
      versionNonce: 1,
      isDeleted: false,
    },
  }
  const { error } = await supabase.from(TABLE).insert(forbidden)
  expect(error).toBeTruthy()

  const { data, error: readError } = await supabase.from(TABLE).select('id').eq('id', id)
  expect(readError).toBeNull()
  expect(data).toEqual([])
})
