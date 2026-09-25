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

async function activeRectangles() {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase
    .from(TABLE)
    .select('element,is_deleted')
    .eq('is_deleted', false))
  if (error) throw error
  return (data ?? []).filter(row => row.element?.type === 'rectangle').length
}

async function openCanvasSettings(page: Page) {
  const settings = page.getByLabel('Canvas settings')
  if (!(await settings.isVisible())) await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  await expect(settings).toBeVisible()
  return settings
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('shared history blocks tab-local undo and redo from replaying stale state', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'One browser execution is enough for shared-history keyboard semantics.')

  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [340, 220], [470, 310])
  await expect.poll(activeRectangles).toBe(1)

  const settings = await openCanvasSettings(page)
  const undo = settings.getByLabel('Collaboration controls').getByRole('button', { name: 'Undo my last action' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await page.keyboard.press('Escape')
  await expect.poll(activeRectangles).toBe(0)

  // The own-action stack is now empty. A second Ctrl+Z must not fall through
  // to Excalidraw's tab-local history and resurrect pre-authoritative state.
  await page.keyboard.press('Control+z')
  await expect.poll(activeRectangles).toBe(0)

  // Redo is intentionally unavailable until it can be made server-authoritative.
  for (const shortcut of ['Control+Shift+z', 'Control+y']) {
    await page.keyboard.press(shortcut)
    await expect(page.getByText('Redo is unavailable in shared mode. Make the change again instead.')).toBeVisible()
    await expect.poll(activeRectangles).toBe(0)
  }
})
