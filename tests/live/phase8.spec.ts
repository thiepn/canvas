import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

async function activeRows() {
  const { data, error } = await retryTransientSupabaseTestOperation(() =>
    supabase.from(TABLE).select('id,element,is_deleted').eq('is_deleted', false),
  )
  if (error) throw error
  return data ?? []
}

async function openVisuals(page: Page) {
  await page.getByRole('button', { name: 'Canvas visuals' }).click()
  const menu = page.getByLabel('Canvas visuals menu')
  await expect(menu).toBeVisible()
  return menu
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('visual profile persists locally without mutating the shared scene', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 8 local visual profile needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  expect(await activeRows()).toHaveLength(0)

  let menu = await openVisuals(page)
  await menu.getByRole('button', { name: 'Dark', exact: true }).click()
  await menu.getByRole('button', { name: 'Violet accent' }).click()
  await menu.getByRole('button', { name: 'Warm', exact: true }).click()
  await menu.getByRole('button', { name: 'Lines', exact: true }).click()
  await menu.getByLabel('Grid spacing').evaluate((element: HTMLInputElement) => {
    element.value = '36'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await menu.getByLabel('Grid strength').evaluate((element: HTMLInputElement) => {
    element.value = '22'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await menu.getByRole('button', { name: 'Full', exact: true }).click()

  const root = page.locator('.live-canvas-app')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-canvas-accent', 'violet')
  await expect(page.locator('html')).toHaveAttribute('data-canvas-paper', 'warm')
  await expect(root).toHaveAttribute('data-canvas-grid', 'lines')
  await expect(root).toHaveAttribute('data-canvas-motion', 'full')
  await expect(page.locator('.canvas-backdrop')).toHaveAttribute('data-grid-pattern', 'lines')
  expect(await activeRows()).toHaveLength(0)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-canvas-accent', 'violet')
  await expect(page.locator('html')).toHaveAttribute('data-canvas-paper', 'warm')
  await expect(root).toHaveAttribute('data-canvas-grid', 'lines')

  menu = await openVisuals(page)
  await expect(menu.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByRole('button', { name: 'Violet accent' })).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByRole('button', { name: 'Warm', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByRole('button', { name: 'Lines', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByLabel('Grid spacing')).toHaveValue('36')
  await expect(menu.getByLabel('Grid strength')).toHaveValue('22')
  expect(await activeRows()).toHaveLength(0)
})

test('background grid is scene-locked and square mode remains compatible with native grid controls', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 8 background contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  let menu = await openVisuals(page)
  await menu.getByRole('button', { name: 'Dots', exact: true }).click()
  await menu.getByLabel('Grid spacing').evaluate((element: HTMLInputElement) => {
    element.value = '24'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const backdrop = page.locator('.canvas-backdrop')
  await expect(backdrop).toHaveAttribute('data-grid-pattern', 'dots')

  const beforeSize = await backdrop.evaluate(element => getComputedStyle(element).getPropertyValue('--canvas-grid-size').trim())
  expect(beforeSize).toBe('24px')

  await page.getByRole('button', { name: 'Zoom presets' }).click()
  await page.getByRole('button', { name: '200%', exact: true }).click()
  await expect.poll(async () =>
    backdrop.evaluate(element => getComputedStyle(element).getPropertyValue('--canvas-grid-size').trim()),
  ).toBe('48px')

  menu = await openVisuals(page)
  await menu.getByRole('button', { name: 'Squares', exact: true }).click()
  await expect(page.locator('.live-canvas-app')).toHaveAttribute('data-canvas-grid', 'squares')
  await expect(backdrop).toHaveAttribute('data-grid-pattern', 'none')

  // The existing selection-toolbar Grid preference remains the visibility
  // control for every Phase 8 background style.
  await menu.getByRole('button', { name: 'None', exact: true }).click()
  await expect(page.locator('.live-canvas-app')).toHaveAttribute('data-canvas-grid', 'none')
  await expect(backdrop).toHaveAttribute('data-grid-pattern', 'none')
})

test('vector stamps persist as normal shared Canvas objects and survive reload', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 8 stamp contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Shape library' }).click()
  const library = page.getByLabel('Shape library menu')
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'Heart', exact: true }).click()

  let id = ''
  await expect.poll(async () => {
    const row = (await activeRows()).find(candidate => {
      const element = candidate.element as Record<string, unknown>
      const customData = element.customData as Record<string, unknown> | undefined
      const shape = customData?.canvasShape as Record<string, unknown> | undefined
      return element.type === 'rectangle' && shape?.kind === 'heart'
    })
    id = String(row?.id ?? '')
    return Boolean(row)
  }).toBe(true)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const row = (await activeRows()).find(candidate => candidate.id === id)
    const element = row?.element as Record<string, unknown> | undefined
    const customData = element?.customData as Record<string, unknown> | undefined
    const shape = customData?.canvasShape as Record<string, unknown> | undefined
    return shape?.kind
  }).toBe('heart')
})

test('reduced motion and delight controls stay local and respect the visual profile', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 8 delight contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  let menu = await openVisuals(page)
  await menu.getByRole('button', { name: 'Full', exact: true }).click()
  await menu.getByRole('button', { name: 'Tiny sparkle' }).click()
  await expect(page.locator('.canvas-delight-burst')).toBeVisible()

  menu = await openVisuals(page)
  await menu.getByRole('button', { name: 'Reduced', exact: true }).click()
  await expect(page.locator('.live-canvas-app')).toHaveAttribute('data-canvas-motion', 'reduced')
  expect(await activeRows()).toHaveLength(0)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.locator('.live-canvas-app')).toHaveAttribute('data-canvas-motion', 'reduced')
})
