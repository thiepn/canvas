import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas, readScene } from './scene-helpers.ts'

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

async function selectTool(page: Page, title: RegExp, roleName: RegExp) {
  await page.getByTitle(title).click()
  await expect(page.getByRole('radio', { name: roleName })).toBeChecked()
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
  await expect(page.getByTestId('toolbar-LaserPointer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeVisible()

  // The properties panel occupies the left 220px when a drawing tool is active.
  await selectTool(page, /^Rectangle\b/i, /^Rectangle\b/i)
  await dragOnCanvas(page, [300, 150], [410, 220])
  await waitForType('rectangle')

  await selectTool(page, /^Ellipse\b/i, /^Ellipse\b/i)
  await dragOnCanvas(page, [480, 150], [580, 225])
  await waitForType('ellipse')

  await selectTool(page, /^Diamond\b/i, /^Diamond\b/i)
  await dragOnCanvas(page, [650, 150], [750, 230])
  await waitForType('diamond')

  await selectTool(page, /^Line\b/i, /^Line\b/i)
  await dragOnCanvas(page, [300, 285], [410, 335])
  await waitForType('line')

  await selectTool(page, /^Arrow\b/i, /^Arrow\b/i)
  await dragOnCanvas(page, [480, 285], [590, 335])
  await waitForType('arrow')

  await selectTool(page, /^Draw\b/i, /^Draw\b/i)
  await dragOnCanvas(page, [660, 285], [750, 340], 14)
  await waitForType('freedraw')

  await selectTool(page, /^Text\b/i, /^Text\b/i)
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  await page.mouse.click(box.x + 300, box.y + 410)
  await page.keyboard.type('Production path text')
  await page.keyboard.press('Escape')
  await waitForType('text')

  await page.getByRole('button', { name: 'Frame tool' }).click()
  await dragOnCanvas(page, [630, 385], [820, 485])
  await waitForType('frame')

  const beforeDelete = await deletedCount()
  await selectTool(page, /^Eraser\b/i, /^Eraser\b/i)
  await dragOnCanvas(page, [280, 185], [430, 185], 14)
  await expect.poll(deletedCount).toBeGreaterThan(beforeDelete)

  const expectedTypes = ['ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'frame']
  const types = await activeTypes()
  for (const type of expectedTypes) expect(types).toContain(type)
  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const restored = await readScene(page)
  for (const type of expectedTypes) expect(restored.map(element => element.type)).toContain(type)
  expect(restored.some(element => element.type === 'rectangle')).toBe(false)
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
  // Excalidraw's compact 320px toolbar intentionally omits the Laser button.
  await expect(page.getByTestId('toolbar-LaserPointer')).toHaveCount(0)

  const menuButton = page.getByRole('button', { name: 'Canvas menu and presence' })
  await expect(menuButton).toBeVisible()
  await menuButton.click()
  const settings = page.getByLabel('Canvas settings')
  await expect(settings).toBeVisible()
  await expect(settings.getByLabel('Display name')).toBeVisible()
  await expect(settings.getByLabel('Appearance')).toBeHidden()
  await expect(settings.getByRole('button', { name: 'Frame tool' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Export JSON backup' })).toBeVisible()
})

test('offline state pauses editing and returns to Live after reconnect', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Offline', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sync-health="offline"]')).toBeVisible()
  await expect(page.locator('.network-banner')).toContainText('Editing is paused')
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeDisabled()

  await context.setOffline(false)
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
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
